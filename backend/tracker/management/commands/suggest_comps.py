from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations

from django.core.management.base import BaseCommand

from tracker.models import Participant


@dataclass
class Board:
    units: set[str]
    placement: int


def _format_unit(unit_id: str) -> str:
    return unit_id.replace("TFT16_", "").replace("TFT15_", "").replace("TFT14_", "")


class Command(BaseCommand):
    help = (
        "Suggest top comps to create from DB by frequency. "
        "Outputs: LVL Base, always units, and flex units."
    )

    def add_arguments(self, parser):
        parser.add_argument("--top", type=int, default=10, help="How many comps to suggest (default: 10).")
        parser.add_argument(
            "--game-version",
            type=str,
            default="",
            help="Optional filter for a specific game version.",
        )
        parser.add_argument(
            "--min-occurrences",
            type=int,
            default=8,
            help="Minimum occurrences for a candidate core (default: 8).",
        )
        parser.add_argument(
            "--min-core-size",
            type=int,
            default=5,
            help="Minimum 'always units' size (default: 5).",
        )
        parser.add_argument(
            "--core-size-mode",
            type=str,
            default="auto",
            choices=["auto", "fixed"],
            help="auto = adapt core sizes (4/5/6); fixed = use provided core sizes only.",
        )
        parser.add_argument(
            "--core-sizes",
            type=str,
            default="5",
            help="Comma-separated core sizes for fixed mode (default: 5). Example: 4,5,6",
        )
        parser.add_argument(
            "--levels",
            type=str,
            default="8,9,10",
            help="Comma-separated base levels to analyze (default: 8,9,10).",
        )

    def handle(self, *args, **options):
        top_n = max(1, int(options["top"]))
        game_version = (options.get("game_version") or "").strip()
        min_occ = max(1, int(options["min_occurrences"]))
        min_core_size = max(1, int(options["min_core_size"]))
        levels = self._parse_levels(options.get("levels") or "8,9,10")
        core_size_mode = (options.get("core_size_mode") or "auto").strip().lower()
        fixed_core_sizes = self._parse_sizes(options.get("core_sizes") or "5")

        boards = self._load_boards(game_version=game_version)
        if not boards:
            self.stdout.write(self.style.WARNING("No boards found for analysis."))
            return

        self.stdout.write(
            f"Loaded {len(boards)} boards. Analyzing levels={levels}, min_core_size={min_core_size}..."
        )

        candidates = []
        for level in levels:
            level_candidates = self._candidates_for_level(
                boards=boards,
                level=level,
                min_core_size=min_core_size,
                min_occ=min_occ,
                core_size_mode=core_size_mode,
                fixed_core_sizes=fixed_core_sizes,
            )
            candidates.extend(level_candidates)

        if not candidates:
            self.stdout.write(self.style.WARNING("No candidates matched your filters."))
            return

        # Primary objective: highest frequency. Tie-breaker: better AVP.
        candidates.sort(key=lambda c: (-c["occurrences"], c["avg_placement"], c["level"], c["core"]))
        deduped = self._dedupe_similar(candidates)
        final = deduped[:top_n]

        self.stdout.write(self.style.SUCCESS(f"\nTop {len(final)} suggested comps to create:"))
        for idx, row in enumerate(final, start=1):
            always_units = ", ".join(_format_unit(u) for u in row["core"])
            flex_units = ", ".join(_format_unit(u) for u in row["flex"])
            self.stdout.write(
                f"\n{idx}. LVL Base: {row['level']}  |  Occurrences: {row['occurrences']}  |  AVP: {row['avg_placement']:.2f}\n"
                f"   Unidades que sempre estao ({len(row['core'])}): {always_units}\n"
                f"   Unidades flex ({row['level']} - {len(row['core'])} = {row['flex_slots']}): {flex_units if flex_units else '-'}"
            )

    def _parse_levels(self, raw: str) -> list[int]:
        levels: list[int] = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                value = int(part)
            except ValueError:
                continue
            if 1 <= value <= 10 and value not in levels:
                levels.append(value)
        return levels or [8, 9, 10]

    def _parse_sizes(self, raw: str) -> list[int]:
        sizes: list[int] = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                value = int(part)
            except ValueError:
                continue
            if 1 <= value <= 10 and value not in sizes:
                sizes.append(value)
        return sizes or [5]

    def _load_boards(self, game_version: str) -> list[Board]:
        qs = Participant.objects.prefetch_related("unit_usages__unit").order_by("id")
        if game_version:
            qs = qs.filter(match__game_version=game_version)

        boards: list[Board] = []
        for p in qs.iterator(chunk_size=500):
            units = {
                uu.unit.character_id
                for uu in p.unit_usages.all()
                if uu.unit_id and uu.unit and uu.unit.character_id
            }
            if len(units) < 5:
                continue
            boards.append(Board(units=units, placement=p.placement))
        return boards

    def _candidates_for_level(
        self,
        boards: list[Board],
        level: int,
        min_core_size: int,
        min_occ: int,
        core_size_mode: str,
        fixed_core_sizes: list[int],
    ) -> list[dict]:
        eligible = [b for b in boards if len(b.units) >= level]
        if not eligible:
            return []

        core_counts: dict[tuple[str, ...], dict] = defaultdict(
            lambda: {"count": 0, "placement_sum": 0}
        )

        if core_size_mode == "fixed":
            allowed_sizes = sorted({s for s in fixed_core_sizes if min_core_size <= s < level})
            if not allowed_sizes:
                return []
        else:
            # Auto mode: start with 5 as baseline, include 6 if strong, fallback to 4 if 5 collapses.
            probe_sizes = [s for s in (4, 5, 6) if min_core_size <= s < level]
            if not probe_sizes:
                return []

            probe_best: dict[int, int] = {}
            for size in probe_sizes:
                local_counts: Counter[tuple[str, ...]] = Counter()
                for b in eligible:
                    ordered_units = tuple(sorted(b.units))
                    for core in combinations(ordered_units, size):
                        local_counts[core] += 1
                probe_best[size] = max(local_counts.values()) if local_counts else 0

            best4 = probe_best.get(4, 0)
            best5 = probe_best.get(5, 0)
            best6 = probe_best.get(6, 0)

            allowed = set()
            if best5 >= min_occ:
                allowed.add(5)
            # "6 is obvious": support close to 5 support.
            if best6 >= min_occ and (best5 == 0 or best6 >= int(best5 * 0.80)):
                allowed.add(6)
            # "5 drops too much": 4 is significantly stronger than 5.
            if best4 >= min_occ and (best5 == 0 or best5 < int(best4 * 0.60)):
                allowed.add(4)
            # Safety fallback
            if not allowed:
                for s in (5, 4, 6):
                    if s in probe_best and probe_best[s] > 0 and s < level:
                        allowed.add(s)
                        break
            allowed_sizes = sorted(allowed)

        for b in eligible:
            ordered_units = tuple(sorted(b.units))
            for size in allowed_sizes:
                for core in combinations(ordered_units, size):
                    stats = core_counts[core]
                    stats["count"] += 1
                    stats["placement_sum"] += b.placement

        ranked_cores = [
            (core, stats)
            for core, stats in core_counts.items()
            if stats["count"] >= min_occ
        ]
        ranked_cores.sort(
            key=lambda kv: (-kv[1]["count"], kv[1]["placement_sum"] / kv[1]["count"], kv[0])
        )

        # Compute flex only for top pool to keep runtime reasonable.
        pool_size = min(len(ranked_cores), 300)
        output: list[dict] = []
        for core, stats in ranked_cores[:pool_size]:
            core_set = set(core)
            flex_slots = level - len(core)
            if flex_slots <= 0:
                continue

            flex_counter: Counter[str] = Counter()
            for b in eligible:
                if not core_set.issubset(b.units):
                    continue
                for u in (b.units - core_set):
                    flex_counter[u] += 1

            flex = [u for u, _freq in flex_counter.most_common(flex_slots)]
            output.append(
                {
                    "level": level,
                    "core": core,
                    "flex": tuple(flex),
                    "flex_slots": flex_slots,
                    "occurrences": stats["count"],
                    "avg_placement": stats["placement_sum"] / stats["count"],
                }
            )

        return output

    def _dedupe_similar(self, candidates: list[dict]) -> list[dict]:
        # 1) Hard dedupe: same final board (core + flex) on same level.
        best_by_signature: dict[tuple[int, tuple[str, ...]], dict] = {}
        for c in candidates:
            signature = tuple(sorted(set(c["core"]) | set(c["flex"])))
            key = (c["level"], signature)
            prev = best_by_signature.get(key)
            if prev is None:
                best_by_signature[key] = c
                continue
            # Keep stronger candidate by occurrences, then AVP.
            if (c["occurrences"], -c["avg_placement"]) > (
                prev["occurrences"],
                -prev["avg_placement"],
            ):
                best_by_signature[key] = c

        deduped = sorted(
            best_by_signature.values(),
            key=lambda c: (-c["occurrences"], c["avg_placement"], c["level"], c["core"]),
        )

        # 2) Soft dedupe: avoid near-identical outputs among remaining suggestions.
        kept: list[dict] = []
        for c in deduped:
            cset = set(c["core"]) | set(c["flex"])
            too_similar = False
            for k in kept:
                if c["level"] != k["level"]:
                    continue
                kset = set(k["core"]) | set(k["flex"])
                overlap = len(cset & kset)
                union = len(cset | kset)
                similarity = (overlap / union) if union else 0.0
                if similarity >= 0.88:
                    too_similar = True
                    break
            if not too_similar:
                kept.append(c)
        return kept
