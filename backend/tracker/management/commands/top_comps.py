"""
Management command: top_comps

Analyzes all stored games and reports the most commonly played compositions.

A composition is defined by the exact set of units on a player's board.
Only boards with at least --min_units units are counted (default: 5).

Optional --core N mode: instead of exact full-board match, the comp identity
is the N highest-cost units on the board.  This groups boards that share the
same N-unit core even when the "filler" units differ.

Usage:
    python manage.py top_comps
    python manage.py top_comps --min_units 6
    python manage.py top_comps --core 5
    python manage.py top_comps --top 20
    python manage.py top_comps --sort avg_placement
    python manage.py top_comps --game_version "16.6 PBE Alpha"
    python manage.py top_comps --placement 1
    python manage.py top_comps --csv
"""

import re
import sys
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Prefetch

from tracker.models import Match, Participant, Unit, UnitUsage


def _strip_prefix(character_id: str) -> str:
    """'TFT14_Ahri' → 'Ahri', 'TFT_TrainingDummy' → 'TrainingDummy'."""
    return re.sub(r"^TFT\d*_", "", character_id)


class Command(BaseCommand):
    help = "Report the N most common compositions across all stored games."

    def add_arguments(self, parser):
        parser.add_argument(
            "--min_units",
            type=int,
            default=5,
            metavar="N",
            help="Only count boards with at least N units (default: 5)",
        )
        parser.add_argument(
            "--core",
            type=int,
            default=None,
            metavar="N",
            help=(
                "Use the N highest-cost units as the comp identity instead of "
                "the full board.  Useful for grouping boards that share a core "
                "but differ in filler units."
            ),
        )
        parser.add_argument(
            "--top",
            type=int,
            default=10,
            metavar="N",
            help="Number of comps to display (default: 10)",
        )
        parser.add_argument(
            "--sort",
            choices=["count", "avg_placement", "top4_rate", "win_rate"],
            default="count",
            help="Sort key (default: count)",
        )
        parser.add_argument(
            "--game_version",
            type=str,
            default=None,
            metavar="VERSION",
            help="Filter to a specific game version string (substring match)",
        )
        parser.add_argument(
            "--placement",
            type=int,
            default=None,
            metavar="P",
            help="Only consider participants who finished at this placement (e.g. 1 for winners only)",
        )
        parser.add_argument(
            "--csv",
            action="store_true",
            default=False,
            help="Output results as CSV instead of a formatted table",
        )

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def handle(self, *args, **options):
        min_units: int = options["min_units"]
        core_n: int | None = options["core"]
        top_n: int = options["top"]
        sort_key: str = options["sort"]
        game_version: str | None = options["game_version"]
        placement_filter: int | None = options["placement"]
        csv_mode: bool = options["csv"]

        # ── 1. Load unit costs (needed for --core) ─────────────────────
        unit_cost: dict[str, int] = {}
        if core_n is not None:
            for u in Unit.objects.values("character_id", "cost"):
                unit_cost[u["character_id"]] = u["cost"]

        # ── 2. Build queryset ──────────────────────────────────────────
        qs = Participant.objects.select_related("match", "player")
        if game_version:
            qs = qs.filter(match__game_version__icontains=game_version)
        if placement_filter is not None:
            qs = qs.filter(placement=placement_filter)
        qs = qs.prefetch_related(
            Prefetch(
                "unit_usages",
                queryset=UnitUsage.objects.select_related("unit"),
            )
        )

        # ── 3. Aggregate per composition ───────────────────────────────
        # comp_key  → tuple of sorted character_ids (the identity)
        # comp_example → full sorted list of all unit IDs on the board
        #               (used for display when core_n collapses the key)
        Agg = lambda: {"count": 0, "total_placement": 0, "top4": 0, "wins": 0, "examples": []}
        comp_stats: dict[tuple, dict] = defaultdict(Agg)

        skipped_too_few = 0
        total_seen = 0

        for p in qs:
            usages = list(p.unit_usages.all())
            char_ids = [uu.unit.character_id for uu in usages]

            total_seen += 1

            if len(char_ids) < min_units:
                skipped_too_few += 1
                continue

            if core_n is not None:
                # Take the N units with the highest cost; break ties by name
                char_ids_sorted_by_cost = sorted(
                    char_ids,
                    key=lambda cid: (unit_cost.get(cid, 0), cid),
                    reverse=True,
                )
                key_units = tuple(sorted(char_ids_sorted_by_cost[:core_n]))
            else:
                key_units = tuple(sorted(char_ids))

            stat = comp_stats[key_units]
            stat["count"] += 1
            stat["total_placement"] += p.placement
            if p.placement <= 4:
                stat["top4"] += 1
            if p.placement == 1:
                stat["wins"] += 1
            # Keep at most 3 example match IDs for reference
            if len(stat["examples"]) < 3:
                stat["examples"].append(p.match_id)

        # ── 4. Compute derived metrics and rank ────────────────────────
        results = []
        for comp_key, stat in comp_stats.items():
            count = stat["count"]
            avg_p = stat["total_placement"] / count if count else 0.0
            top4_rate = stat["top4"] / count if count else 0.0
            win_rate = stat["wins"] / count if count else 0.0
            results.append({
                "comp_key": comp_key,
                "count": count,
                "avg_placement": avg_p,
                "top4_rate": top4_rate,
                "win_rate": win_rate,
                "wins": stat["wins"],
                "top4": stat["top4"],
                "examples": stat["examples"],
            })

        sort_cfg = {
            "count": ("count", True),
            "avg_placement": ("avg_placement", False),
            "top4_rate": ("top4_rate", True),
            "win_rate": ("win_rate", True),
        }
        sort_field, reverse = sort_cfg[sort_key]
        results.sort(key=lambda r: r[sort_field], reverse=reverse)
        results = results[:top_n]

        # ── 5. Output ──────────────────────────────────────────────────
        if csv_mode:
            self._output_csv(results, core_n)
        else:
            self._output_table(
                results,
                min_units=min_units,
                core_n=core_n,
                top_n=top_n,
                sort_key=sort_key,
                game_version=game_version,
                placement_filter=placement_filter,
                total_seen=total_seen,
                skipped_too_few=skipped_too_few,
                total_unique=len(comp_stats),
            )

    # ------------------------------------------------------------------
    # Output helpers
    # ------------------------------------------------------------------

    def _output_table(
        self,
        results: list[dict],
        *,
        min_units: int,
        core_n: int | None,
        top_n: int,
        sort_key: str,
        game_version: str | None,
        placement_filter: int | None,
        total_seen: int,
        skipped_too_few: int,
        total_unique: int,
    ) -> None:
        W = 72
        sep = "═" * W

        self.stdout.write(self.style.SUCCESS(f"\n{sep}"))
        self.stdout.write(
            self.style.SUCCESS(
                f"  TOP {top_n} MOST COMMON COMPOSITIONS  (sorted by {sort_key})"
            )
        )
        self.stdout.write(self.style.SUCCESS(sep))

        # Summary info
        lines = [
            f"  Participants analysed : {total_seen - skipped_too_few:,}  "
            f"(skipped {skipped_too_few:,} boards with fewer than {min_units} units)",
            f"  Unique compositions   : {total_unique:,}",
        ]
        if game_version:
            lines.append(f"  Game version filter   : \"{game_version}\"")
        if placement_filter is not None:
            lines.append(f"  Placement filter      : {placement_filter}")
        if core_n is not None:
            lines.append(
                f"  Identity mode         : core {core_n} highest-cost units per board"
            )
        else:
            lines.append(f"  Identity mode         : exact full-board match")
        for line in lines:
            self.stdout.write(line)
        self.stdout.write(self.style.SUCCESS(sep))
        self.stdout.write("")

        if not results:
            self.stdout.write(
                self.style.WARNING("  No compositions found matching the given filters.")
            )
            return

        for rank, r in enumerate(results, 1):
            comp_key = r["comp_key"]
            count = r["count"]
            avg_p = r["avg_placement"]
            top4_rate = r["top4_rate"]
            win_rate = r["win_rate"]

            unit_labels = [_strip_prefix(u) for u in comp_key]

            # Header line
            header = (
                f"  #{rank:<3d} "
                f"Played: {count:>4}x  |  "
                f"Avg Place: {avg_p:>4.2f}  |  "
                f"Top4: {top4_rate:>5.1%}  |  "
                f"Win: {win_rate:>5.1%}"
            )
            self.stdout.write(self.style.HTTP_INFO(header))

            # Unit list — wrap at ~70 chars
            unit_line = "       Units: " + ", ".join(unit_labels)
            self.stdout.write(unit_line)

            # Example match IDs
            if r["examples"]:
                ex_line = "       Example matches: " + ", ".join(r["examples"])
                self.stdout.write(ex_line)

            self.stdout.write("")

        self.stdout.write(self.style.SUCCESS(sep + "\n"))

    def _output_csv(self, results: list[dict], core_n: int | None) -> None:
        import csv
        import io

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "rank", "count", "avg_placement", "top4_rate", "win_rate",
            "wins", "top4", "units",
        ])
        for rank, r in enumerate(results, 1):
            writer.writerow([
                rank,
                r["count"],
                f"{r['avg_placement']:.4f}",
                f"{r['top4_rate']:.4f}",
                f"{r['win_rate']:.4f}",
                r["wins"],
                r["top4"],
                "|".join(_strip_prefix(u) for u in r["comp_key"]),
            ])
        self.stdout.write(buf.getvalue())
