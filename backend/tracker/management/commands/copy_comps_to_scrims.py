"""
Copy all Comp objects from PBE to SCRIMS server.
Existing SCRIMS comps with the same name are updated; new ones are created.

Usage:
    python manage.py copy_comps_to_scrims
    python manage.py copy_comps_to_scrims --clear   # delete existing SCRIMS comps first
"""
from django.core.management.base import BaseCommand

from tracker.models import Comp


FIELDS_TO_COPY = [
    "units",
    "target_level",
    "excluded_units",
    "excluded_unit_counts",
    "required_traits",
    "required_unit_counts",
    "required_unit_star_levels",
    "required_unit_item_counts",
    "required_trait_breakpoints",
    "excluded_traits",
    "is_active",
]


class Command(BaseCommand):
    help = "Copy all PBE comps to the SCRIMS server"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete all existing SCRIMS comps before copying",
        )

    def handle(self, *args, **options):
        pbe_comps = Comp.objects.filter(server="PBE")
        count = pbe_comps.count()

        if count == 0:
            self.stdout.write(self.style.WARNING("No PBE comps found."))
            return

        if options["clear"]:
            deleted, _ = Comp.objects.filter(server="SCRIMS").delete()
            self.stdout.write(f"Deleted {deleted} existing SCRIMS comps.")

        created = 0
        updated = 0

        for comp in pbe_comps:
            defaults = {f: getattr(comp, f) for f in FIELDS_TO_COPY}
            _, was_created = Comp.objects.update_or_create(
                name=comp.name,
                server="SCRIMS",
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done — {created} created, {updated} updated ({count} PBE comps processed)."
            )
        )
