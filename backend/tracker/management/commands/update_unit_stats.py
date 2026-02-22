from django.core.management.base import BaseCommand

from tracker.services.aggregation import recompute_unit_stats


class Command(BaseCommand):
    help = "Recompute and persist AggregatedUnitStat from stored match data."

    def handle(self, *args, **options):
        self.stdout.write("Recomputing unit statistics...")
        count = recompute_unit_stats()
        self.stdout.write(self.style.SUCCESS(f"Done - updated stats for {count} unit(s)."))
