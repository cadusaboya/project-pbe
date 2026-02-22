from django.core.management.base import BaseCommand, CommandError

from tracker.models import Comp


class Command(BaseCommand):
    help = "Delete one or more comps by name."

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            action="append",
            default=[],
            help="Comp name to delete. Repeat flag to delete multiple comps.",
        )
        parser.add_argument(
            "--names",
            type=str,
            default="",
            help="Comma-separated comp names to delete.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only show which comps would be deleted.",
        )

    def handle(self, *args, **options):
        names = [n.strip() for n in (options.get("name") or []) if n and n.strip()]
        names_csv = (options.get("names") or "").strip()
        if names_csv:
            names.extend([n.strip() for n in names_csv.split(",") if n.strip()])

        # Deduplicate preserving order
        unique_names = []
        seen = set()
        for n in names:
            key = n.lower()
            if key in seen:
                continue
            seen.add(key)
            unique_names.append(n)

        if not unique_names:
            raise CommandError("Provide at least one comp via --name or --names.")

        existing = list(Comp.objects.filter(name__in=unique_names).values_list("name", flat=True))
        existing_set = {n.lower() for n in existing}
        missing = [n for n in unique_names if n.lower() not in existing_set]

        if not existing:
            self.stdout.write(self.style.WARNING("No matching comps found."))
            if missing:
                self.stdout.write(f"Missing: {', '.join(missing)}")
            return

        self.stdout.write(f"Matched ({len(existing)}): {', '.join(sorted(existing))}")
        if missing:
            self.stdout.write(self.style.WARNING(f"Missing: {', '.join(missing)}"))

        if options.get("dry_run"):
            self.stdout.write(self.style.WARNING("Dry-run enabled. No rows deleted."))
            return

        deleted_count, _ = Comp.objects.filter(name__in=existing).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted rows: {deleted_count}"))
