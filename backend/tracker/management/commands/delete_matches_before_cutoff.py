import datetime
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.management.base import BaseCommand

from tracker.models import Match
from tracker.services.aggregation import recompute_unit_stats

DEFAULT_CUTOFF_DATE = "2026-02-21"
DEFAULT_CUTOFF_TIME = "12:00"
DEFAULT_CUTOFF_TZ = "America/Cuiaba"


class Command(BaseCommand):
    help = (
        "Delete matches with game start time earlier than a cutoff. "
        "Default cutoff: 2026-02-21 12:00 in America/Cuiaba."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be deleted without deleting.",
        )
        parser.add_argument(
            "--skip-recompute",
            action="store_true",
            help="Skip recomputing AggregatedUnitStat after deletion.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        skip_recompute = options["skip_recompute"]

        cutoff_utc, cutoff_label = self._build_cutoff_utc()
        qs = Match.objects.filter(game_datetime__lt=cutoff_utc).order_by("game_datetime")
        total = qs.count()

        self.stdout.write(f"Cutoff: {cutoff_label} ({cutoff_utc.isoformat()} UTC)")
        self.stdout.write(f"Matches before cutoff: {total}")

        if total == 0:
            self.stdout.write(self.style.SUCCESS("Nothing to delete."))
            return

        sample_ids = list(qs.values_list("match_id", flat=True)[:10])
        self.stdout.write(f"Sample match_ids: {sample_ids}")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run only. No rows deleted."))
            return

        deleted_count, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted rows (including cascades): {deleted_count}"))

        if skip_recompute:
            self.stdout.write("Skipped stats recompute (--skip-recompute).")
            return

        self.stdout.write("Recomputing unit statistics...")
        updated = recompute_unit_stats()
        self.stdout.write(self.style.SUCCESS(f"Done - updated stats for {updated} unit(s)."))

    def _build_cutoff_utc(self) -> tuple[datetime.datetime, str]:
        date_str = os.environ.get("PBE_QUEUE_CUTOFF_DATE", DEFAULT_CUTOFF_DATE).strip()
        time_str = os.environ.get("PBE_QUEUE_CUTOFF_TIME", DEFAULT_CUTOFF_TIME).strip()
        tz_name = os.environ.get("PBE_QUEUE_CUTOFF_TZ", DEFAULT_CUTOFF_TZ).strip()

        try:
            tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            self.stdout.write(
                self.style.WARNING(f"Invalid timezone '{tz_name}'. Falling back to UTC.")
            )
            tz = datetime.timezone.utc

        local_naive = datetime.datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        local_dt = local_naive.replace(tzinfo=tz)
        cutoff_utc = local_dt.astimezone(datetime.timezone.utc)
        cutoff_label = f"{date_str} {time_str} {tz.key}"
        return cutoff_utc, cutoff_label
