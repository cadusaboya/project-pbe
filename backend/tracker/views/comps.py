"""
Views for composition analysis: curated comps, hidden (auto-discovered) comps,
winning comps feed, and comp search.
"""

from collections import Counter, defaultdict
from itertools import combinations

from django.db.models import OuterRef, Prefetch, Q, Subquery
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Comp, Match, Participant, Unit, UnitUsage
from ..serializers import WinningCompSerializer
from ..services.cdragon import (
    TRAIT_API_NAME_MAP,
    TRAIT_CACHE,
    ensure_trait_cache,
)
from .helpers import cc, slots_used, unit_slot_weight

# ── Per-module caches ─────────────────────────────────────────────────────────

_COMPS_CACHE: dict[tuple, dict] = {}
_COMPS_CACHE_VERSION: dict[str, int] = {}


# ── View classes ──────────────────────────────────────────────────────────────

class WinningCompsView(ListAPIView):
    """
    GET /api/winning-comps/

    Returns the best-placing tracked pro for each stored match.

    When ``player`` query param(s) are provided, returns ALL games for
    those players at any placement (not just wins).

    Query params:
      limit  -- number of results (default 50)
      player -- (repeatable) case-insensitive game_name filter; returns
               all placements for matched players
    """

    serializer_class = WinningCompSerializer

    def get_queryset(self):
        server = self.request.query_params.get("server", "PBE").upper()
        try:
            limit = int(self.request.query_params.get("limit", 50))
        except ValueError:
            limit = 50

        player_names = self.request.query_params.getlist("player")
        player_names = [n.strip() for n in player_names if n.strip()]

        tracked_lobby = Prefetch(
            "match__participants",
            queryset=Participant.objects.filter(player__isnull=False)
            .select_related("player")
            .order_by("placement"),
            to_attr="_tracked_lobby",
        )

        if player_names:
            q = Q()
            for name in player_names:
                q |= Q(player__game_name__iexact=name)
            qs = (
                Participant.objects.filter(
                    q,
                    match__server=server,
                    player__isnull=False,
                )
                .select_related("match", "player")
                .prefetch_related("unit_usages__unit", tracked_lobby)
                .order_by("-match__game_datetime")
            )
        else:
            # Best tracked pro per match: only participants with a linked player,
            # pick the one with the lowest (best) placement per match.
            best_per_match = (
                Participant.objects.filter(
                    match=OuterRef("match"),
                    match__server=server,
                    player__isnull=False,
                )
                .order_by("placement")
                .values("pk")[:1]
            )
            qs = (
                Participant.objects.filter(
                    pk__in=Subquery(best_per_match),
                    match__server=server,
                    player__isnull=False,
                )
                .select_related("match", "player")
                .prefetch_related("unit_usages__unit", tracked_lobby)
                .order_by("-match__game_datetime")
            )

        game_version = self.request.query_params.get("game_version")
        if game_version:
            qs = qs.filter(match__game_version=game_version)

        return qs[:limit]


class HiddenCompsView(APIView):
    """
    GET /api/comps/hidden/

    Returns the most common discovered core compositions and their best flex add-ons.

    Query params:
      game_version    -- optional version filter
      limit           -- number of core comps to return (default 20)
      core_sizes      -- comma-separated core sizes to analyze (default: 4,5,6)
      min_occurrences -- minimum frequency for a core to be considered (default: 100)
      target_level    -- optional override for board level target; if omitted,
                         backend infers the most common completion level per core
      top_flex        -- number of flex combos per core (default 3)
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        game_version = request.query_params.get("game_version")
        try:
            limit = max(1, int(request.query_params.get("limit", 20)))
        except ValueError:
            limit = 20
        core_sizes_raw = (request.query_params.get("core_sizes") or "4,5,6").strip()
        core_sizes = []
        for part in core_sizes_raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                size = int(part)
            except ValueError:
                continue
            if 1 <= size <= 10 and size not in core_sizes:
                core_sizes.append(size)
        if not core_sizes:
            core_sizes = [5]
        core_sizes.sort()
        try:
            min_occurrences = max(1, int(request.query_params.get("min_occurrences", 100)))
        except ValueError:
            min_occurrences = 100
        target_level_override_raw = request.query_params.get("target_level")
        target_level_override = None
        if target_level_override_raw is not None:
            try:
                target_level_override = max(1, min(10, int(target_level_override_raw)))
            except ValueError:
                target_level_override = None
        try:
            top_flex = max(1, int(request.query_params.get("top_flex", 5)))
        except ValueError:
            top_flex = 5

        participants = (
            Participant.objects.filter(match__server=server, player__isnull=False)
            .select_related("match")
            .prefetch_related("unit_usages__unit")
            .order_by("id")
        )
        if game_version:
            participants = participants.filter(match__game_version=game_version)

        boards: list[dict] = []
        all_units: set[str] = set()
        for p in participants.iterator(chunk_size=500):
            units = sorted({
                uu.unit.character_id
                for uu in p.unit_usages.all()
                if uu.unit_id and uu.unit and uu.unit.character_id
            })
            if len(units) < core_sizes[0]:
                continue
            unit_set = set(units)
            all_units |= unit_set
            boards.append({
                "match_id": p.match_id,
                "placement": p.placement,
                "level": p.level,
                "units": units,
                "unit_set": unit_set,
            })

        if not boards:
            return Response([])

        unit_cost_map = dict(
            Unit.objects.filter(character_id__in=all_units).values_list("character_id", "cost")
        )
        unit_traits_map = dict(
            Unit.objects.filter(character_id__in=all_units).values_list("character_id", "traits")
        )

        core_stats: dict[tuple[str, ...], dict] = defaultdict(
            lambda: {"count": 0, "total_placement": 0, "matches": set(), "level_counts": defaultdict(int)}
        )
        for b in boards:
            units_len = len(b["units"])
            for size in core_sizes:
                if size > units_len:
                    break
                for core in combinations(b["units"], size):
                    row = core_stats[core]
                    row["count"] += 1
                    row["total_placement"] += b["placement"]
                    row["matches"].add(b["match_id"])
                    row["level_counts"][b["level"]] += 1

        ranked_cores = sorted(
            (
                (core, info)
                for core, info in core_stats.items()
                if info["count"] >= min_occurrences
            ),
            key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
        )[:limit]

        result = []
        for core_units, core_info in ranked_cores:
            core_set = set(core_units)
            core_size_current = slots_used(core_units)
            if target_level_override is not None:
                target_level = target_level_override
            else:
                # Prefer late-game levels when available.
                late_levels = {
                    lvl: cnt
                    for lvl, cnt in core_info["level_counts"].items()
                    if lvl in (8, 9, 10)
                }
                level_counts = late_levels if late_levels else core_info["level_counts"]
                target_level = sorted(
                    level_counts.items(),
                    key=lambda kv: (-kv[1], -kv[0]),
                )[0][0]
                target_level = max(core_size_current, min(10, int(target_level)))

            if core_size_current >= target_level:
                flex_size = 1 if target_level < 10 else 0
            else:
                flex_size = target_level - core_size_current

            flex_stats: dict[tuple[str, ...], dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0, "matches": set()}
            )
            flex_unit_stats: dict[str, dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0}
            )
            matching_flex_count = 0

            for b in boards:
                if not core_set.issubset(b["unit_set"]):
                    continue
                remaining = sorted(b["unit_set"] - core_set)
                if not remaining:
                    continue
                matching_flex_count += 1
                flex_key = tuple(remaining)
                row = flex_stats[flex_key]
                row["count"] += 1
                row["total_placement"] += b["placement"]
                row["matches"].add(b["match_id"])
                for unit_id in remaining:
                    fp = flex_unit_stats[unit_id]
                    fp["count"] += 1
                    fp["total_placement"] += b["placement"]

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]

            flex_picks = []
            if matching_flex_count > 0:
                for unit_id, fp_info in sorted(
                    flex_unit_stats.items(),
                    key=lambda kv: (-kv[1]["count"], kv[1]["total_placement"] / kv[1]["count"]),
                ):
                    flex_picks.append({
                        "character_id": unit_id,
                        "cost": unit_cost_map.get(unit_id, 0),
                        "rate": round(fp_info["count"] / matching_flex_count, 3),
                        "games": fp_info["count"],
                        "avg_placement": round(fp_info["total_placement"] / fp_info["count"], 2),
                    })

            trait_counts: dict[str, int] = defaultdict(int)
            for u in core_units:
                traits = unit_traits_map.get(u) or []
                for t in traits:
                    name = str(t).strip()
                    if not name:
                        continue
                    trait_counts[name] += 1
            core_traits = [
                {"name": name, "units": cnt}
                for name, cnt in sorted(
                    trait_counts.items(),
                    key=lambda kv: (-kv[1], kv[0]),
                )
                if cnt >= 2
            ][:3]

            result.append({
                "target_level": target_level,
                "core_size": core_size_current,
                "flex_slots": flex_size,
                "core_traits": core_traits,
                "core_units": [
                    {"character_id": u, "cost": unit_cost_map.get(u, 0)}
                    for u in core_units
                ],
                "comps": core_info["count"],
                "matches": len(core_info["matches"]),
                "avg_placement": round(core_info["total_placement"] / core_info["count"], 2),
                "flex_combos": [
                    {
                        "units": [
                            {"character_id": u, "cost": unit_cost_map.get(u, 0)}
                            for u in flex_units
                        ],
                        "comps": info["count"],
                        "matches": len(info["matches"]),
                        "avg_placement": round(info["total_placement"] / info["count"], 2),
                    }
                    for flex_units, info in ranked_flex
                ],
                "flex_picks": flex_picks,
            })

        return Response(result)


class CompsView(APIView):
    """
    GET /api/comps/

    Returns stats for manually created comps from the Comp table,
    including best flex add-ons and AVP.

    Query params:
      game_version -- optional version filter
      limit        -- max number of comps to return (default 20)
      top_flex     -- number of flex combos per comp (default 3)
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        game_version = request.query_params.get("game_version")
        limit_raw = request.query_params.get("limit")
        limit = None
        if limit_raw is not None:
            try:
                limit = max(1, int(limit_raw))
            except ValueError:
                limit = None
        try:
            top_flex = max(1, int(request.query_params.get("top_flex", 5)))
        except ValueError:
            top_flex = 5

        global _COMPS_CACHE, _COMPS_CACHE_VERSION
        comp_count = Comp.objects.filter(server=server).count()
        match_count = Match.objects.filter(server=server).count()
        data_version = (match_count, comp_count)
        cache_key = (server, game_version, limit, top_flex)
        if data_version == _COMPS_CACHE_VERSION.get(server, -1) and cache_key in _COMPS_CACHE:
            return cc(Response(_COMPS_CACHE[cache_key]), 300)

        comps_qs = Comp.objects.filter(is_active=True, server=server).order_by("name")
        if limit is not None:
            comps_qs = comps_qs[:limit]
        comps = list(comps_qs)
        if not comps:
            return Response([])
        comp_units_all: set[str] = set()
        for comp in comps:
            raw_units = comp.units if isinstance(comp.units, list) else []
            comp_units_all |= {str(u).strip() for u in raw_units if str(u).strip()}

        base_qs = Participant.objects.filter(match__server=server, player__isnull=False).order_by("id")
        if game_version:
            base_qs = base_qs.filter(match__game_version=game_version)

        boards: list[dict] = []
        all_units: set[str] = set()
        match_participant_cache: dict[str, dict[str, dict]] = {}
        _CHUNK = 2000
        last_id = 0
        while True:
            chunk = list(
                base_qs.filter(id__gt=last_id)
                .select_related("match")
                .prefetch_related(
                    Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
                )
                .defer("match__raw_json")
                [:_CHUNK]
            )
            if not chunk:
                break
            last_id = chunk[-1].id

            # Batch-fetch raw_json for all matches in this chunk (fixes N+1 query)
            chunk_match_ids = {p.match_id for p in chunk}
            chunk_raw_jsons = dict(
                Match.objects.filter(match_id__in=chunk_match_ids)
                .values_list("match_id", "raw_json")
            )

            for p in chunk:
                unit_set: set[str] = set()
                item_count_by_unit: dict[str, int] = {}
                unit_count_by_unit: dict[str, int] = {}
                unit_max_star_by_unit: dict[str, int] = {}
                for uu in p.unit_usages.all():
                    if not uu.unit_id or not uu.unit or not uu.unit.character_id:
                        continue
                    char_id = uu.unit.character_id
                    unit_set.add(char_id)
                    item_count_by_unit[char_id] = max(
                        item_count_by_unit.get(char_id, 0),
                        len(uu.items or []),
                    )
                    unit_count_by_unit[char_id] = unit_count_by_unit.get(char_id, 0) + 1
                    unit_max_star_by_unit[char_id] = max(
                        unit_max_star_by_unit.get(char_id, 0),
                        int(uu.star_level or 0),
                    )
                if not unit_set:
                    continue

                active_traits = set()
                trait_unit_counts: dict[str, int] = {}
                trait_tiers: dict[str, int] = {}
                match_map = match_participant_cache.get(p.match_id)
                if match_map is None:
                    raw = chunk_raw_jsons.get(p.match_id)
                    participants_data = (raw or {}).get("info", {}).get("participants", [])
                    match_map = {
                        str(pp.get("puuid", "")): pp
                        for pp in participants_data
                        if pp.get("puuid")
                    }
                    match_participant_cache[p.match_id] = match_map
                pdata = match_map.get(p.puuid)
                if pdata:
                    for t in pdata.get("traits", []) or []:
                        tier_current = t.get("tier_current", 0) or 0
                        num_units = t.get("num_units", 0) or 0
                        if tier_current > 0 or num_units > 0:
                            name = str(t.get("name", "")).strip()
                            if name:
                                active_traits.add(name)
                                try:
                                    trait_unit_counts[name] = max(int(num_units), trait_unit_counts.get(name, 0))
                                except (TypeError, ValueError):
                                    trait_unit_counts[name] = max(0, trait_unit_counts.get(name, 0))
                                trait_tiers[name] = max(int(tier_current), trait_tiers.get(name, 0))

                boards.append({
                    "match_id": p.match_id,
                    "placement": p.placement,
                    "level": p.level,
                    "unit_set": unit_set,
                    "item_count_by_unit": item_count_by_unit,
                    "unit_count_by_unit": unit_count_by_unit,
                    "unit_max_star_by_unit": unit_max_star_by_unit,
                    "active_traits": active_traits,
                    "trait_unit_counts": trait_unit_counts,
                    "trait_tiers": trait_tiers,
                })
                all_units |= unit_set

        lookup_units = all_units | comp_units_all
        _unit_rows = Unit.objects.filter(character_id__in=lookup_units).values_list(
            "character_id", "cost", "traits"
        )
        unit_cost_map: dict[str, int] = {}
        unit_traits_map: dict[str, list] = {}
        for char_id, cost, traits in _unit_rows:
            unit_cost_map[char_id] = cost
            unit_traits_map[char_id] = traits
        for b in boards:
            derived_trait_counts: dict[str, int] = defaultdict(int)
            for unit_id, count in b["unit_count_by_unit"].items():
                traits = unit_traits_map.get(unit_id) or []
                for t in traits:
                    name = str(t).strip()
                    if not name:
                        continue
                    derived_trait_counts[name] += count
            b["derived_trait_counts"] = dict(derived_trait_counts)

        _comps_api_name_map = TRAIT_API_NAME_MAP.get(server, {})

        def _comp_trait_matches(req_lower: str, api_name: str) -> bool:
            api_lower = api_name.lower()
            if req_lower in api_lower:
                return True
            # Match without spaces (e.g. "shadow isles" vs "tft16_shadowisles")
            if req_lower.replace(" ", "") in api_lower:
                return True
            display = _comps_api_name_map.get(api_name, "")
            return bool(display and req_lower in display.lower())

        def _max_trait_units(board: dict, req_lower: str) -> int:
            matched_units = 0
            for trait_name, units_count in board["trait_unit_counts"].items():
                if _comp_trait_matches(req_lower, trait_name):
                    matched_units = max(matched_units, units_count)
            # Fallback when participant trait payload does not include the trait
            # but unit metadata still has it.
            if matched_units == 0:
                for trait_name, units_count in board.get("derived_trait_counts", {}).items():
                    if _comp_trait_matches(req_lower, trait_name):
                        matched_units = max(matched_units, units_count)
            return matched_units

        def _max_trait_tier(board: dict, req_lower: str) -> int:
            matched_tier = 0
            for trait_name, tier in board.get("trait_tiers", {}).items():
                if _comp_trait_matches(req_lower, trait_name):
                    matched_tier = max(matched_tier, tier)
            return matched_tier

        ensure_trait_cache(server)
        _server_trait_cache = TRAIT_CACHE.get(server, {})

        def _breakpoint_tier(display_name: str, min_units: int) -> int:
            """Convert a min_units value to a 1-based tier using CDragon breakpoints."""
            tdata = _server_trait_cache.get(display_name)
            if not tdata:
                # Try case-insensitive match
                for dname, td in _server_trait_cache.items():
                    if dname.lower() == display_name.lower():
                        tdata = td
                        break
            if not tdata:
                return 0
            bps = tdata.get("breakpoints", [])
            tier = 0
            for i, bp in enumerate(bps):
                if min_units >= bp:
                    tier = i + 1
            return tier

        result = []
        for comp in comps:
            raw_units = comp.units if isinstance(comp.units, list) else []
            base_units = [str(u).strip() for u in raw_units if str(u).strip()]
            core_unit_counts: Counter[str] = Counter(base_units)
            raw_excluded = comp.excluded_units if isinstance(comp.excluded_units, list) else []
            excluded_set = {str(u).strip() for u in raw_excluded if str(u).strip()}
            raw_excluded_unit_counts = (
                comp.excluded_unit_counts
                if isinstance(comp.excluded_unit_counts, dict)
                else {}
            )
            excluded_unit_counts = {
                str(unit).strip(): max(1, int(cnt))
                for unit, cnt in raw_excluded_unit_counts.items()
                if str(unit).strip()
            }
            raw_required_traits = comp.required_traits if isinstance(comp.required_traits, list) else []
            required_traits = [str(t).strip() for t in raw_required_traits if str(t).strip()]
            required_traits_lower = [t.lower() for t in required_traits]
            raw_required_items = (
                comp.required_unit_item_counts
                if isinstance(comp.required_unit_item_counts, dict)
                else {}
            )
            required_item_counts = {
                str(unit).strip(): max(1, int(cnt))
                for unit, cnt in raw_required_items.items()
                if str(unit).strip()
            }
            raw_required_unit_counts = (
                comp.required_unit_counts
                if isinstance(comp.required_unit_counts, dict)
                else {}
            )
            required_unit_counts = {
                str(unit).strip(): max(1, int(cnt))
                for unit, cnt in raw_required_unit_counts.items()
                if str(unit).strip()
            }
            explicit_required_unit_counts = dict(required_unit_counts)
            for unit_id, min_count in required_unit_counts.items():
                core_unit_counts[unit_id] = max(core_unit_counts.get(unit_id, 0), min_count)
            raw_required_unit_star_levels = (
                comp.required_unit_star_levels
                if isinstance(comp.required_unit_star_levels, dict)
                else {}
            )
            required_unit_star_levels = {
                str(unit).strip(): max(1, min(int(star), 3))
                for unit, star in raw_required_unit_star_levels.items()
                if str(unit).strip()
            }

            core_units = sorted(core_unit_counts.keys())
            raw_required_breakpoints = (
                comp.required_trait_breakpoints
                if isinstance(comp.required_trait_breakpoints, dict)
                else {}
            )
            required_trait_breakpoints = {}
            for trait, cnt in raw_required_breakpoints.items():
                trait_name = str(trait).strip()
                if not trait_name:
                    continue
                try:
                    required_trait_breakpoints[trait_name] = max(1, int(cnt))
                except (TypeError, ValueError):
                    continue

            # Precompute required tier for each trait breakpoint
            required_trait_tier_map: dict[str, int] = {}
            for trait_name, min_units in required_trait_breakpoints.items():
                required_trait_tier_map[trait_name.lower()] = _breakpoint_tier(
                    trait_name, min_units
                )

            raw_excluded_traits = (
                comp.excluded_traits
                if isinstance(comp.excluded_traits, dict)
                else {}
            )
            excluded_traits = {}
            for trait, cnt in raw_excluded_traits.items():
                trait_name = str(trait).strip()
                if not trait_name:
                    continue
                try:
                    excluded_traits[trait_name] = max(1, int(cnt))
                except (TypeError, ValueError):
                    continue

            has_any_constraint = (
                core_unit_counts
                or required_traits_lower
                or required_trait_breakpoints
                or required_item_counts
                or required_unit_star_levels
                or excluded_set
                or excluded_unit_counts
                or excluded_traits
            )
            if not has_any_constraint:
                continue

            target_level = max(1, min(int(comp.target_level or 9), 10))
            core_size = sum(
                unit_slot_weight(unit_id) * count
                for unit_id, count in core_unit_counts.items()
            )
            core_count = 0
            core_total_placement = 0
            core_top4_count = 0
            core_win_count = 0
            core_matches = set()
            flex_stats: dict[tuple[str, ...], dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0, "matches": set()}
            )
            flex_unit_stats: dict[str, dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0}
            )
            matching_flex_count = 0

            for b in boards:
                if excluded_set and (excluded_set & b["unit_set"]):
                    continue
                if excluded_unit_counts:
                    blocked_by_count = False
                    for unit_id, min_count in excluded_unit_counts.items():
                        if b["unit_count_by_unit"].get(unit_id, 0) >= min_count:
                            blocked_by_count = True
                            break
                    if blocked_by_count:
                        continue
                has_core_units = all(
                    b["unit_count_by_unit"].get(unit_id, 0) >= min_count
                    for unit_id, min_count in core_unit_counts.items()
                )
                if not has_core_units:
                    continue
                if required_traits_lower:
                    ok_traits = True
                    for req in required_traits_lower:
                        if _max_trait_units(b, req) <= 0:
                            ok_traits = False
                            break
                    if not ok_traits:
                        continue
                if required_item_counts:
                    ok_items = True
                    for unit_id, min_items in required_item_counts.items():
                        if b["item_count_by_unit"].get(unit_id, 0) < min_items:
                            ok_items = False
                            break
                    if not ok_items:
                        continue
                if explicit_required_unit_counts:
                    ok_unit_counts = True
                    for unit_id, min_count in explicit_required_unit_counts.items():
                        if b["unit_count_by_unit"].get(unit_id, 0) < min_count:
                            ok_unit_counts = False
                            break
                    if not ok_unit_counts:
                        continue
                if required_unit_star_levels:
                    ok_stars = True
                    for unit_id, min_star in required_unit_star_levels.items():
                        if b["unit_max_star_by_unit"].get(unit_id, 0) < min_star:
                            ok_stars = False
                            break
                    if not ok_stars:
                        continue
                if required_trait_breakpoints:
                    ok_breakpoints = True
                    for req_trait, min_units in required_trait_breakpoints.items():
                        req_lower = req_trait.lower()
                        req_tier = required_trait_tier_map.get(req_lower, 0)
                        if req_tier > 0:
                            board_tier = _max_trait_tier(b, req_lower)
                            if board_tier < req_tier:
                                ok_breakpoints = False
                                break
                        else:
                            # Fallback to num_units if trait not in CDragon cache
                            matched_units = _max_trait_units(b, req_lower)
                            if matched_units < min_units:
                                ok_breakpoints = False
                                break
                    if not ok_breakpoints:
                        continue
                if excluded_traits:
                    ok_excluded = True
                    for req_trait, threshold in excluded_traits.items():
                        req_lower = req_trait.lower()
                        matched_units = _max_trait_units(b, req_lower)
                        if matched_units >= threshold:
                            ok_excluded = False
                            break
                    if not ok_excluded:
                        continue
                if has_core_units:
                    core_count += 1
                    core_total_placement += b["placement"]
                    if b["placement"] <= 4:
                        core_top4_count += 1
                    if b["placement"] == 1:
                        core_win_count += 1
                    core_matches.add(b["match_id"])
                remaining_counter = Counter(b["unit_count_by_unit"])
                for unit_id, used_count in core_unit_counts.items():
                    if unit_id in remaining_counter:
                        remaining_counter[unit_id] = max(0, remaining_counter[unit_id] - used_count)
                remaining_pool = []
                for unit_id, count in sorted(remaining_counter.items()):
                    if count > 0:
                        remaining_pool.extend([unit_id] * count)
                if not remaining_pool:
                    continue
                matching_flex_count += 1
                flex_key = tuple(remaining_pool)
                row = flex_stats[flex_key]
                row["count"] += 1
                row["total_placement"] += b["placement"]
                row["matches"].add(b["match_id"])
                for unit_id in set(remaining_pool):
                    fp = flex_unit_stats[unit_id]
                    fp["count"] += 1
                    fp["total_placement"] += b["placement"]

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]

            flex_picks = []
            if matching_flex_count > 0:
                for unit_id, fp_info in sorted(
                    flex_unit_stats.items(),
                    key=lambda kv: (-kv[1]["count"], kv[1]["total_placement"] / kv[1]["count"]),
                ):
                    flex_picks.append({
                        "character_id": unit_id,
                        "cost": unit_cost_map.get(unit_id, 0),
                        "rate": round(fp_info["count"] / matching_flex_count, 3),
                        "games": fp_info["count"],
                        "avg_placement": round(fp_info["total_placement"] / fp_info["count"], 2),
                    })
            avg_placement = round(core_total_placement / core_count, 2) if core_count else 0.0
            top4_rate = round(core_top4_count / core_count, 3) if core_count else 0.0
            win_rate = round(core_win_count / core_count, 3) if core_count else 0.0

            trait_counts: dict[str, int] = defaultdict(int)
            for u, count in core_unit_counts.items():
                traits = unit_traits_map.get(u) or []
                for t in traits:
                    name = str(t).strip()
                    if not name:
                        continue
                    trait_counts[name] += count
            core_traits = [
                {"name": name, "units": cnt}
                for name, cnt in sorted(
                    trait_counts.items(),
                    key=lambda kv: (-kv[1], kv[0]),
                )
                if cnt >= 2
            ][:3]

            result.append({
                "name": comp.name,
                "target_level": target_level,
                "core_size": core_size,
                "flex_slots": None,
                "core_traits": core_traits,
                "core_units": [
                    {"character_id": u, "cost": unit_cost_map.get(u, 0)}
                    for u in core_units
                    for _ in range(core_unit_counts[u])
                ],
                "comps": core_count,
                "matches": len(core_matches),
                "avg_placement": avg_placement,
                "top4_rate": top4_rate,
                "win_rate": win_rate,
                # Constraint fields for Data Explorer
                "excluded_units": sorted(excluded_set),
                "required_traits": required_traits,
                "excluded_unit_counts": dict(excluded_unit_counts),
                "required_unit_star_levels": dict(required_unit_star_levels),
                "required_unit_item_counts": dict(required_item_counts),
                "required_trait_breakpoints": dict(required_trait_breakpoints),
                "excluded_traits": dict(excluded_traits),
                "flex_combos": [
                    {
                        "units": [
                            {"character_id": u, "cost": unit_cost_map.get(u, 0)}
                            for u in flex_units
                        ],
                        "comps": info["count"],
                        "matches": len(info["matches"]),
                        "avg_placement": round(info["total_placement"] / info["count"], 2),
                    }
                    for flex_units, info in ranked_flex
                ],
                "flex_picks": flex_picks,
            })

        total_games = len({b["match_id"] for b in boards})
        total_comps = len(boards)

        result = [r for r in result if r["comps"] > 0]
        result.sort(key=lambda x: (-x["comps"], x["avg_placement"], x["name"]))
        comps_list = result[:limit] if limit is not None else result
        response_data = {"total_games": total_games, "total_comps": total_comps, "comps": comps_list}
        if data_version != _COMPS_CACHE_VERSION.get(server, -1):
            stale_keys = [k for k in _COMPS_CACHE if k[0] == server]
            for k in stale_keys:
                _COMPS_CACHE.pop(k, None)
            _COMPS_CACHE_VERSION[server] = data_version
        _COMPS_CACHE[cache_key] = response_data
        return cc(Response(response_data), 300)


class SearchCompsView(APIView):
    """
    GET /api/search-comps/

    Returns all participants whose comp contains ALL specified units.

    Query params:
      unit         -- repeatable; case-insensitive substring on character_id
      game_version -- optional version filter
      limit        -- max results (default 200, max 500)
      sort         -- recency (default) | placement
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        units = [u.strip() for u in request.query_params.getlist("unit") if u.strip()]
        game_version = request.query_params.get("game_version")
        try:
            limit = max(1, min(500, int(request.query_params.get("limit", 200))))
        except ValueError:
            limit = 200
        sort = request.query_params.get("sort", "recency")

        tracked_lobby = Prefetch(
            "match__participants",
            queryset=Participant.objects.filter(player__isnull=False)
            .select_related("player")
            .order_by("placement"),
            to_attr="_tracked_lobby",
        )
        qs = Participant.objects.filter(match__server=server, player__isnull=False).select_related("match", "player").prefetch_related(
            Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit")),
            tracked_lobby,
        )
        if game_version:
            qs = qs.filter(match__game_version=game_version)

        for unit_text in units:
            qs = qs.filter(unit_usages__unit__character_id__icontains=unit_text)
        qs = qs.distinct()

        if sort == "placement":
            qs = qs.order_by("placement", "-match__game_datetime")
        else:
            qs = qs.order_by("-match__game_datetime")

        result = []
        for p in qs[:limit]:
            player_name = str(p.player) if p.player else p.puuid[:12]
            units_out = []
            for uu in p.unit_usages.all():
                if not uu.unit_id or not uu.unit:
                    continue
                units_out.append({
                    "character_id": uu.unit.character_id,
                    "star_level": uu.star_level,
                    "cost": uu.unit.cost,
                    "traits": uu.unit.traits,
                    "items": uu.items or [],
                })
            lobby = [
                {"name": str(lp.player), "placement": lp.placement}
                for lp in getattr(p.match, "_tracked_lobby", [])
                if lp.pk != p.pk
            ]
            result.append({
                "match_id": p.match.match_id,
                "game_datetime": p.match.game_datetime,
                "game_version": p.match.game_version,
                "placement": p.placement,
                "level": p.level,
                "player": player_name,
                "units": units_out,
                "lobby_players": lobby,
            })

        return Response(result)
