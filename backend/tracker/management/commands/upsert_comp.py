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
        parser.add_argument(
            "--require-traits",
            type=str,
            default="",
            help=(
                "Comma-separated required active traits. "
                "Example: --require-traits 'Bilgewater,Sniper'"
            ),
        )
        parser.add_argument(
            "--require-items",
            type=str,
            default="",
            help=(
                "Comma-separated unit:min_items rules. "
                "Example: --require-items 'MissFortune:3,Swain:2'"
            ),
        )
        parser.add_argument(
            "--require-trait-breakpoints",
            type=str,
            default="",
            help=(
                "Comma-separated trait:min_units rules. "
                "Example: --require-trait-breakpoints 'Ionia:7,Noxus:4'"
            ),
        )
        parser.add_argument(
            "--max-trait-counts",
            type=str,
            default="",
            help=(
                "Comma-separated trait:max_units rules. "
                "Example: --max-trait-counts 'Noxus:3'"
            ),
        )

    def handle(self, *args, **options):
        name = options["name"].strip()
        units_raw = options["units"].strip()
        prefix = options["prefix"].strip() or "TFT16_"
        is_active = not options["inactive"]
        target_level = max(1, min(int(options["level"]), 10))
        exclude_raw = (options.get("exclude") or "").strip()
        require_traits_raw = (options.get("require_traits") or "").strip()
        require_items_raw = (options.get("require_items") or "").strip()
        require_trait_breakpoints_raw = (options.get("require_trait_breakpoints") or "").strip()
        max_trait_counts_raw = (options.get("max_trait_counts") or "").strip()

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

        required_traits: list[str] = []
        if require_traits_raw:
            required_traits = [t.strip() for t in require_traits_raw.split(",") if t.strip()]

        required_unit_item_counts: dict[str, int] = {}
        if require_items_raw:
            for raw_rule in [r.strip() for r in require_items_raw.split(",") if r.strip()]:
                if ":" not in raw_rule:
                    raise CommandError(
                        f"Invalid require-items rule '{raw_rule}'. Use Unit:Count format."
                    )
                raw_unit, raw_count = raw_rule.split(":", 1)
                unit_norm = self._normalize_token(raw_unit.strip(), prefix)
                try:
                    min_count = max(1, int(raw_count.strip()))
                except ValueError as exc:
                    raise CommandError(
                        f"Invalid item count in rule '{raw_rule}'. Must be integer."
                    ) from exc
                required_unit_item_counts[unit_norm] = min_count

        required_trait_breakpoints: dict[str, int] = {}
        if require_trait_breakpoints_raw:
            for raw_rule in [r.strip() for r in require_trait_breakpoints_raw.split(",") if r.strip()]:
                if ":" not in raw_rule:
                    raise CommandError(
                        f"Invalid require-trait-breakpoints rule '{raw_rule}'. Use Trait:Count format."
                    )
                raw_trait, raw_count = raw_rule.split(":", 1)
                trait_name = raw_trait.strip()
                if not trait_name:
                    raise CommandError(f"Trait name cannot be empty in '{raw_rule}'.")
                try:
                    min_units = max(1, int(raw_count.strip()))
                except ValueError as exc:
                    raise CommandError(
                        f"Invalid breakpoint in rule '{raw_rule}'. Must be integer."
                    ) from exc
                required_trait_breakpoints[trait_name] = min_units

        max_trait_counts: dict[str, int] = {}
        if max_trait_counts_raw:
            for raw_rule in [r.strip() for r in max_trait_counts_raw.split(",") if r.strip()]:
                if ":" not in raw_rule:
                    raise CommandError(
                        f"Invalid max-trait-counts rule '{raw_rule}'. Use Trait:Count format."
                    )
                raw_trait, raw_count = raw_rule.split(":", 1)
                trait_name = raw_trait.strip()
                if not trait_name:
                    raise CommandError(f"Trait name cannot be empty in '{raw_rule}'.")
                try:
                    max_units = max(0, int(raw_count.strip()))
                except ValueError as exc:
                    raise CommandError(
                        f"Invalid max count in rule '{raw_rule}'. Must be integer."
                    ) from exc
                max_trait_counts[trait_name] = max_units

        comp, created = Comp.objects.update_or_create(
            name=name,
            defaults={
                "units": units,
                "target_level": target_level,
                "excluded_units": excluded_units,
                "required_traits": required_traits,
                "required_unit_item_counts": required_unit_item_counts,
                "required_trait_breakpoints": required_trait_breakpoints,
                "max_trait_counts": max_trait_counts,
                "is_active": is_active,
            },
        )

        verb = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} comp: {comp.name}"))
        self.stdout.write(f"Units ({len(units)}): {', '.join(units)}")
        self.stdout.write(f"Target level: {comp.target_level}")
        if comp.excluded_units:
            self.stdout.write(f"Excluded: {', '.join(comp.excluded_units)}")
        if comp.required_traits:
            self.stdout.write(f"Required traits: {', '.join(comp.required_traits)}")
        if comp.required_unit_item_counts:
            pretty = ", ".join(
                f"{k}:{v}" for k, v in comp.required_unit_item_counts.items()
            )
            self.stdout.write(f"Required items: {pretty}")
        if comp.required_trait_breakpoints:
            pretty = ", ".join(
                f"{k}:{v}" for k, v in comp.required_trait_breakpoints.items()
            )
            self.stdout.write(f"Required trait breakpoints: {pretty}")
        if comp.max_trait_counts:
            pretty = ", ".join(
                f"{k}:{v}" for k, v in comp.max_trait_counts.items()
            )
            self.stdout.write(f"Max trait counts: {pretty}")
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
