from django.core.management.base import BaseCommand

from tracker.models import Match

OLD_VERSION = "16.6B - No T-Hex Items"
NEW_VERSION = "16.6 B"


class Command(BaseCommand):
    help = f"Rename game_version '{OLD_VERSION}' to '{NEW_VERSION}' on all matching matches."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show how many rows would be changed without writing to the database.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        count = Match.objects.filter(game_version=OLD_VERSION).count()

        if count == 0:
            self.stdout.write("No matches found with version "
                              f"'{OLD_VERSION}'. Nothing to update.")
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f"Dry run: would update {count} match(es) "
                f"from '{OLD_VERSION}' to '{NEW_VERSION}'."
            ))
            return

        updated = Match.objects.filter(game_version=OLD_VERSION).update(
            game_version=NEW_VERSION
        )
        self.stdout.write(self.style.SUCCESS(
            f"Updated {updated} match(es) from '{OLD_VERSION}' to '{NEW_VERSION}'."
        ))
