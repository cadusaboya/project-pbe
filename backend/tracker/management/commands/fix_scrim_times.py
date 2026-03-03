"""
Update game_datetime of all SCRIMS matches to 1:09 PM America/Cuiaba,
keeping the original date.

Usage:
    python manage.py fix_scrim_times
    python manage.py fix_scrim_times --date 2026-03-01   # only matches on that date
"""
from datetime import time

import zoneinfo

from django.core.management.base import BaseCommand

from tracker.models import Match

TZ = zoneinfo.ZoneInfo("America/Cuiaba")
TARGET_TIME = time(13, 9)


class Command(BaseCommand):
    help = "Set game_datetime of SCRIMS matches to 1:09 PM America/Cuiaba"

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            help="Only fix matches on this date (YYYY-MM-DD). Default: all SCRIMS matches.",
        )

    def handle(self, *args, **options):
        qs = Match.objects.filter(server="SCRIMS")

        if options["date"]:
            from datetime import datetime
            target_date = datetime.strptime(options["date"], "%Y-%m-%d").date()
            # Filter matches whose game_datetime falls on that date in Cuiaba tz
            qs = [m for m in qs if m.game_datetime.astimezone(TZ).date() == target_date]
        else:
            qs = list(qs)

        if not qs:
            self.stdout.write(self.style.WARNING("No SCRIMS matches found."))
            return

        updated = 0
        for match in qs:
            local_dt = match.game_datetime.astimezone(TZ)
            new_dt = local_dt.replace(hour=TARGET_TIME.hour, minute=TARGET_TIME.minute, second=0, microsecond=0)
            if match.game_datetime != new_dt:
                match.game_datetime = new_dt
                match.save(update_fields=["game_datetime"])
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Updated {updated} of {len(qs)} SCRIMS matches to 1:09 PM America/Cuiaba.")
        )
