from django.core.management.base import BaseCommand, CommandError

from tracker.models import Comp, Unit


class Command(BaseCommand):
    help = (
        "Create or update a Comp from CLI. "
        "Accepts short unit names and normalizes to TFT16 ids."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            type=str,
            required=True,
            help="Comp name. Example: --name 'Kalista Carry'",
        )
        parser.add_argument(
            "--units",
            type=str,
            required=True,
            help=(
                "Comma-separated units. Accepts short names or full IDs. "
                "Example: --units 'Kaisa,ChoGath,KogMaw,RiftHerald,Swain,Volibear'"
            ),
        )
        parser.add_argument(
            "--prefix",
            type=str,
            default="TFT16_",
            help="Prefix used for short names (default: TFT16_).",
        )
        parser.add_argument(
            "--inactive",
            action="store_true",
            help="Create/update comp as inactive.",
        )
        parser.add_argument(
            "--level",
            type=int,
            default=8,
            help="Target board level for this comp (default: 8).",
        )
        parser.add_argument(
            "--exclude",
            type=str,
            default="",
            help=(
                "Comma-separated units to exclude from this comp stats/flex suggestions. "
                "Accepts short names or full IDs."
            ),
        )

    def handle(self, *args, **options):
        name = options["name"].strip()
        units_raw = options["units"].strip()
        prefix = options["prefix"].strip() or "TFT16_"
        is_active = not options["inactive"]
        target_level = max(1, min(int(options["level"]), 10))
        exclude_raw = (options.get("exclude") or "").strip()

        if not name:
            raise CommandError("--name cannot be empty.")
        if not units_raw:
            raise CommandError("--units cannot be empty.")

        raw_parts = [p.strip() for p in units_raw.split(",")]
        raw_parts = [p for p in raw_parts if p]
        if not raw_parts:
            raise CommandError("No valid units parsed from --units.")

        # Build case-insensitive lookup from existing Unit rows.
        existing_units = {
            u.character_id.lower(): u.character_id
            for u in Unit.objects.only("character_id")
        }

        normalized: list[str] = []
        unresolved: list[str] = []
        for token in raw_parts:
            candidate = self._normalize_token(token, prefix)
            resolved = existing_units.get(candidate.lower(), candidate)
            normalized.append(resolved)
            if resolved.lower() not in existing_units:
                unresolved.append(token)

        # Deduplicate while preserving order.
        seen = set()
        units = []
        for u in normalized:
            if u in seen:
                continue
            seen.add(u)
            units.append(u)

        excluded_units: list[str] = []
        if exclude_raw:
            exclude_parts = [p.strip() for p in exclude_raw.split(",")]
            exclude_parts = [p for p in exclude_parts if p]
            normalized_excluded = [self._normalize_token(t, prefix) for t in exclude_parts]
            seen_ex = set()
            for u in normalized_excluded:
                if u in seen_ex:
                    continue
                seen_ex.add(u)
                excluded_units.append(u)

        comp, created = Comp.objects.update_or_create(
            name=name,
            defaults={
                "units": units,
                "target_level": target_level,
                "excluded_units": excluded_units,
                "is_active": is_active,
            },
        )

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} comp: {comp.name}"))
        self.stdout.write(f"Units ({len(units)}): {', '.join(units)}")
        self.stdout.write(f"Target level: {comp.target_level}")
        if comp.excluded_units:
            self.stdout.write(f"Excluded: {', '.join(comp.excluded_units)}")
        self.stdout.write(f"Active: {comp.is_active}")

        if unresolved:
            self.stdout.write(
                self.style.WARNING(
                    "Warning: some units were not found in Unit table and were saved as normalized text: "
                    + ", ".join(unresolved)
                )
            )

    def _normalize_token(self, token: str, prefix: str) -> str:
        t = token.strip().replace(" ", "")
        if not t:
            return t

        # Convert Set16_ prefix to TFT16_ for convenience.
        if t.lower().startswith("set16_"):
            return "TFT16_" + t[6:]

        if t.upper().startswith("TFT"):
            return t

        return f"{prefix}{t}"
