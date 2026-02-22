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
    ) -> list[dict]:
        eligible = [b for b in boards if len(b.units) >= level]
        if not eligible:
            return []

        core_counts: dict[tuple[str, ...], dict] = defaultdict(lambda: {"count": 0, "placement_sum": 0})
        max_core_size = max(min_core_size, level - 1)

        for b in eligible:
            ordered_units = tuple(sorted(b.units))
            for size in range(min_core_size, max_core_size + 1):
                if size >= level:
                    break
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
        kept: list[dict] = []
        for c in candidates:
            is_similar = False
            cset = set(c["core"])
            for k in kept:
                if c["level"] != k["level"]:
                    continue
                kset = set(k["core"])
                overlap = len(cset & kset)
                union = len(cset | kset)
                similarity = (overlap / union) if union else 0.0
                if similarity >= 0.8:
                    is_similar = True
                    break
            if not is_similar:
                kept.append(c)
        return kept
