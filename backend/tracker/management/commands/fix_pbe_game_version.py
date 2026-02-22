import datetime
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.management.base import BaseCommand

from tracker.models import Match

GAME_VERSION_WITH_THEX = "16.6 A"
GAME_VERSION_NO_THEX = "16.6 A - No THex Items"
DEFAULT_SWITCH_DATE = "2026-02-21"
DEFAULT_SWITCH_TIME = "21:10"
DEFAULT_SWITCH_TZ = "America/Cuiaba"


class Command(BaseCommand):
    help = (
        "Recompute Match.game_version using the 16.6A breakpoint rule: "
        "before cutoff -> '16.6 A', from cutoff onward -> '16.6 A - No THex Items'."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show how many rows would be changed without writing to the database.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=1000,
            help="Batch size for bulk updates (default: 1000).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        batch_size = max(1, int(options["batch_size"]))
        switch_dt_utc = self._build_switch_datetime_utc()

        qs = Match.objects.filter(
            game_version__in=[GAME_VERSION_WITH_THEX, GAME_VERSION_NO_THEX]
        ).order_by("match_id")

        total = qs.count()
        if total == 0:
            self.stdout.write("No matches found with 16.6 A labels. Nothing to fix.")
            return

        self.stdout.write(
            f"Evaluating {total} match(es) with cutoff {switch_dt_utc.isoformat()} UTC"
        )

        changed = 0
        pending_updates: list[Match] = []

        for match in qs.iterator(chunk_size=batch_size):
            expected = self._expected_version(match, switch_dt_utc)
            if match.game_version == expected:
                continue

            match.game_version = expected
            changed += 1
            if not dry_run:
                pending_updates.append(match)
                if len(pending_updates) >= batch_size:
                    Match.objects.bulk_update(pending_updates, ["game_version"])
                    pending_updates.clear()

        if not dry_run and pending_updates:
            Match.objects.bulk_update(pending_updates, ["game_version"])

        if dry_run:
            self.stdout.write(self.style.WARNING(f"Dry run: would update {changed} match(es)."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Updated {changed} match(es)."))

    def _build_switch_datetime_utc(self) -> datetime.datetime:
        switch_date = os.environ.get("PBE_166A_SWITCH_DATE", DEFAULT_SWITCH_DATE).strip()
        switch_time = os.environ.get("PBE_166A_SWITCH_TIME", DEFAULT_SWITCH_TIME).strip()
        tz_name = os.environ.get("PBE_166A_TZ", DEFAULT_SWITCH_TZ).strip()

        try:
            tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            self.stdout.write(
                self.style.WARNING(f"Invalid timezone '{tz_name}'. Falling back to UTC.")
            )
            tz = datetime.timezone.utc

        naive_switch = datetime.datetime.strptime(
            f"{switch_date} {switch_time}", "%Y-%m-%d %H:%M"
        )
        local_switch = naive_switch.replace(tzinfo=tz)
        return local_switch.astimezone(datetime.timezone.utc)

    def _expected_version(self, match: Match, switch_dt_utc: datetime.datetime) -> str:
        info = (match.raw_json or {}).get("info", {})
        game_length_s = info.get("game_length") or 0
        try:
            game_length_s = max(float(game_length_s), 0.0)
        except (TypeError, ValueError):
            game_length_s = 0.0

        game_start = match.game_datetime
        if game_start.tzinfo is None:
            game_start = game_start.replace(tzinfo=datetime.timezone.utc)

        game_end_utc = game_start.astimezone(datetime.timezone.utc) + datetime.timedelta(
            seconds=game_length_s
        )
        if game_end_utc >= switch_dt_utc:
            return GAME_VERSION_NO_THEX
        return GAME_VERSION_WITH_THEX
