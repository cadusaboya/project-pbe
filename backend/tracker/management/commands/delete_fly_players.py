"""
Management command: delete_fly_players

Deletes all PBE Player records that were created on-the-fly by match_processor
(identified by tag_line="unknown"). Their Participant FK is SET_NULL on delete,
so no match data is lost.

Usage:
    python manage.py delete_fly_players           # dry-run (default)
    python manage.py delete_fly_players --confirm  # actually delete
"""
from django.core.management.base import BaseCommand

from tracker.models import Player


class Command(BaseCommand):
    help = "Delete PBE players created on-the-fly (tag_line='unknown')."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Actually delete. Without this flag, only a dry-run count is shown.",
        )

    def handle(self, *args, **options):
        qs = Player.objects.filter(tag_line="unknown", region="PBE")
        count = qs.count()

        if count == 0:
            self.stdout.write(self.style.SUCCESS("No on-the-fly players found."))
            return

        if not options["confirm"]:
            self.stdout.write(
                f"Found {count} on-the-fly player(s). "
                "Run with --confirm to delete them."
            )
            return

        deleted, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} on-the-fly player(s)."))
