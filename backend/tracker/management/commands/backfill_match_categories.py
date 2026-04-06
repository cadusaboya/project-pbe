"""
Backfill match_category, match_tier on Match and counts_for_stats on Participant
for all existing PBE matches.

Usage:
    python manage.py backfill_match_categories
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Classify existing PBE matches into PROJECT_PBE / PRO_RANDOM and set counts_for_stats on participants."

    def handle(self, *args, **options):
        from tracker.models import Match, Participant, Player
        from tracker.services.match_processor import classify_pbe_match

        # Build puuid → Player map for PBE players
        pbe_players = Player.objects.filter(puuid__isnull=False, region="PBE").exclude(puuid="")
        puuid_to_player = {p.puuid: p for p in pbe_players}
        self.stdout.write(f"Loaded {len(puuid_to_player)} PBE players.")

        # Load all participants for PBE matches in one query
        self.stdout.write("Loading all PBE participants...")
        match_participants: dict[str, list] = {}
        for p in Participant.objects.filter(match__server="PBE").only("pk", "match_id", "puuid", "player_id"):
            match_participants.setdefault(p.match_id, []).append(p)

        total = len(match_participants)
        self.stdout.write(f"Classifying {total} PBE matches...")

        # Classify all matches and collect IDs per category
        project_pbe_ids: dict[str, list[str]] = {"tier1": [], "tier2": [], "open": []}
        pro_random_ids: list[str] = []
        # Participant PKs that need counts_for_stats=True (PROJECT_PBE untracked)
        set_true_pks: list[int] = []
        # Participant PKs that need counts_for_stats=False (PRO_RANDOM untracked)
        set_false_pks: list[int] = []

        for i, (match_id, participants) in enumerate(match_participants.items()):
            puuids = [p.puuid for p in participants]
            category, tier = classify_pbe_match(puuids, puuid_to_player)

            if category == "PROJECT_PBE":
                project_pbe_ids[tier].append(match_id)
                # All 8 count — find any that are untracked (player_id=None)
                for p in participants:
                    if p.player_id is None:
                        set_true_pks.append(p.pk)
            else:
                pro_random_ids.append(match_id)
                # Only tracked count — find untracked and set False
                for p in participants:
                    if p.player_id is None:
                        set_false_pks.append(p.pk)

            if (i + 1) % 5000 == 0:
                self.stdout.write(f"  Classified {i + 1}/{total}...")

        # Bulk update matches by category/tier
        for tier, ids in project_pbe_ids.items():
            if ids:
                updated = Match.objects.filter(match_id__in=ids).update(
                    match_category="PROJECT_PBE", match_tier=tier
                )
                self.stdout.write(f"  PROJECT_PBE/{tier}: {updated} matches")

        if pro_random_ids:
            updated = Match.objects.filter(match_id__in=pro_random_ids).update(
                match_category="PRO_RANDOM", match_tier=None
            )
            self.stdout.write(f"  PRO_RANDOM: {updated} matches")

        # Bulk update participant counts_for_stats
        BATCH = 5000
        if set_true_pks:
            for i in range(0, len(set_true_pks), BATCH):
                Participant.objects.filter(pk__in=set_true_pks[i:i + BATCH]).update(counts_for_stats=True)
            self.stdout.write(f"  Set counts_for_stats=True for {len(set_true_pks)} untracked participants in PROJECT_PBE matches.")

        if set_false_pks:
            for i in range(0, len(set_false_pks), BATCH):
                Participant.objects.filter(pk__in=set_false_pks[i:i + BATCH]).update(counts_for_stats=False)
            self.stdout.write(f"  Set counts_for_stats=False for {len(set_false_pks)} untracked participants in PRO_RANDOM matches.")

        # Also set counts_for_stats=True for all LIVE participants with a player
        live_updated = Participant.objects.filter(
            match__server="LIVE",
            player__isnull=False,
            counts_for_stats=False,
        ).update(counts_for_stats=True)
        if live_updated:
            self.stdout.write(f"  Set counts_for_stats=True for {live_updated} LIVE tracked participants.")

        self.stdout.write(self.style.SUCCESS("Backfill complete."))
