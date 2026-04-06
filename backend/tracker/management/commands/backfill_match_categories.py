"""
Backfill match_category, match_tier on Match and counts_for_stats on Participant
for all existing PBE matches. Also resolves unknown players in PROJECT_PBE matches
by fetching their Riot account info.

Usage:
    python manage.py backfill_match_categories
"""
import asyncio
import os

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Classify existing PBE matches into PROJECT_PBE / PRO_RANDOM, set counts_for_stats, and resolve unknown players."

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
        set_true_pks: list[int] = []
        set_false_pks: list[int] = []
        # Collect (puuid, match_tier, participant_pk) for unknown players in PROJECT_PBE
        unknown_in_project: list[tuple[str, str, int]] = []

        for i, (match_id, participants) in enumerate(match_participants.items()):
            puuids = [p.puuid for p in participants]
            category, tier = classify_pbe_match(puuids, puuid_to_player)

            if category == "PROJECT_PBE":
                project_pbe_ids[tier].append(match_id)
                for p in participants:
                    if p.player_id is None:
                        set_true_pks.append(p.pk)
                        unknown_in_project.append((p.puuid, tier, p.pk))
            else:
                pro_random_ids.append(match_id)
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

        # ── Resolve unknown players in PROJECT_PBE matches ──────────────
        if not unknown_in_project:
            self.stdout.write(self.style.SUCCESS("No unknown players to resolve. Backfill complete."))
            return

        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(self.style.WARNING(
                f"RIOT_API_KEY not set — skipping resolution of {len(unknown_in_project)} unknown participants. "
                "Set the key and re-run to resolve them."
            ))
            return

        # Dedupe by puuid (same player can appear in multiple matches)
        unique_puuids: dict[str, str] = {}  # puuid → first tier seen
        puuid_to_pks: dict[str, list[int]] = {}  # puuid → all participant PKs
        for puuid, tier, pk in unknown_in_project:
            if puuid not in unique_puuids:
                unique_puuids[puuid] = tier
            puuid_to_pks.setdefault(puuid, []).append(pk)

        # Filter out puuids that already have Player records
        existing_puuids = set(
            Player.objects.filter(puuid__in=list(unique_puuids.keys())).values_list("puuid", flat=True)
        )
        # Link existing players first
        if existing_puuids:
            existing_players = {p.puuid: p for p in Player.objects.filter(puuid__in=existing_puuids)}
            linked = 0
            for puuid, player in existing_players.items():
                pks = puuid_to_pks.get(puuid, [])
                if pks:
                    Participant.objects.filter(pk__in=pks, player__isnull=True).update(player=player)
                    linked += len(pks)
            self.stdout.write(f"  Linked {linked} participants to {len(existing_players)} existing players.")

        to_resolve = [p for p in unique_puuids if p not in existing_puuids]
        if not to_resolve:
            self.stdout.write(self.style.SUCCESS("All unknown players already had records. Backfill complete."))
            return

        self.stdout.write(f"  Resolving {len(to_resolve)} unknown puuids via Riot API...")

        from tracker.management.commands._fetch_utils import _fetch_accounts_by_puuid_async

        # Fetch in batches to avoid overwhelming the API
        RESOLVE_BATCH = 20
        created_count = 0
        failed_count = 0

        for batch_start in range(0, len(to_resolve), RESOLVE_BATCH):
            batch = to_resolve[batch_start:batch_start + RESOLVE_BATCH]
            accounts = asyncio.run(_fetch_accounts_by_puuid_async(api_key, batch))

            for puuid, account in zip(batch, accounts):
                if not account or not account.get("gameName"):
                    failed_count += 1
                    continue

                tier = unique_puuids[puuid]
                player, _ = Player.objects.get_or_create(
                    puuid=puuid,
                    defaults={
                        "game_name": account["gameName"],
                        "tag_line": account.get("tagLine", ""),
                        "region": "PBE",
                        "tier": tier,
                    },
                )

                pks = puuid_to_pks.get(puuid, [])
                if pks:
                    Participant.objects.filter(pk__in=pks, player__isnull=True).update(player=player)

                created_count += 1

            self.stdout.write(f"    Resolved {min(batch_start + RESOLVE_BATCH, len(to_resolve))}/{len(to_resolve)}...")

        self.stdout.write(f"  Created {created_count} new players, {failed_count} failed to resolve.")
        self.stdout.write(self.style.SUCCESS("Backfill complete."))
