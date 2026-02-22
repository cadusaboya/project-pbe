"""
Compute the most common compositions as exact 5-unit sets.

Definition used:
- For each participant board, generate all unique 5-unit combinations.
- Count how often each 5-unit combination appears across all boards.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from django.core.management.base import BaseCommand

from tracker.models import Participant


@dataclass
class Board:
    match_id: str
    placement: int
    units: tuple[str, ...]


class Command(BaseCommand):
    help = (
        "Find top most common exact 5-unit compositions across stored boards "
        "(or another size with --combo-size)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--top", type=int, default=10, help="Top N results (default: 10).")
        parser.add_argument(
            "--combo-size",
            type=int,
            default=5,
            help="Composition size K (default: 5).",
        )
        parser.add_argument(
            "--min-board-units",
            type=int,
            default=5,
            help="Ignore boards with fewer than this many unique units (default: 5).",
        )
        parser.add_argument(
            "--game-version",
            type=str,
            default="",
            help="Optional game_version filter. Example: --game-version '16.6 A'",
        )
        parser.add_argument(
            "--placement",
            type=int,
            default=0,
            help="Optional placement filter (1..8). Use 0 for all (default: 0).",
        )

    def handle(self, *args, **options):
        top_n = max(1, int(options["top"]))
        combo_size = max(1, int(options["combo_size"]))
        min_board_units = max(combo_size, int(options["min_board_units"]))
        game_version = (options.get("game_version") or "").strip()
        placement = int(options.get("placement") or 0)

        self.stdout.write("Loading participant boards...")
        boards = self._load_boards(
            min_board_units=min_board_units,
            game_version=game_version,
            placement=placement,
        )
        if not boards:
            self.stdout.write(self.style.WARNING("No valid boards found."))
            return

        self.stdout.write(
            f"Loaded {len(boards)} boards. Counting exact {combo_size}-unit compositions..."
        )
        if game_version:
            self.stdout.write(f"Applied game_version filter: {game_version}")
        if 1 <= placement <= 8:
            self.stdout.write(f"Applied placement filter: #{placement}")

        stats = self._count_combinations(boards, combo_size=combo_size)
        ranked = sorted(
            stats.items(),
            key=lambda kv: (-kv[1]["count"], kv[0]),
        )

        self.stdout.write(self.style.SUCCESS(f"\nTop {top_n} composition groups:"))
        for idx, (combo, info) in enumerate(ranked[:top_n], start=1):
            units = ", ".join(combo)
            avg_place = info["total_placement"] / info["count"] if info["count"] else 0.0
            self.stdout.write(
                f"{idx:>2}. comps={info['count']:<5} "
                f"matches={len(info['matches']):<5} "
                f"avg_place={avg_place:.2f} "
                f"core=[{units}]"
            )

    def _load_boards(
        self,
        min_board_units: int,
        game_version: str,
        placement: int,
    ) -> list[Board]:
        queryset = (
            Participant.objects.select_related("match")
            .prefetch_related("unit_usages__unit")
            .order_by("id")
        )
        if game_version:
            queryset = queryset.filter(match__game_version=game_version)
        if 1 <= placement <= 8:
            queryset = queryset.filter(placement=placement)

        boards: list[Board] = []
        for p in queryset.iterator(chunk_size=500):
            unit_set = {
                uu.unit.character_id
                for uu in p.unit_usages.all()
                if uu.unit_id and uu.unit and uu.unit.character_id
            }
            if len(unit_set) < min_board_units:
                continue
            boards.append(
                Board(
                    match_id=p.match_id,
                    placement=p.placement,
                    units=tuple(sorted(unit_set)),
                )
            )
        return boards

    def _count_combinations(self, boards: list[Board], combo_size: int):
        stats = defaultdict(lambda: {"count": 0, "total_placement": 0, "matches": set()})
        for b in boards:
            for combo in combinations(b.units, combo_size):
                row = stats[combo]
                row["count"] += 1
                row["total_placement"] += b.placement
                row["matches"].add(b.match_id)
        return stats
