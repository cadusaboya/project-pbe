"""
Views for the Data Explorer: advanced boolean filtering of participant boards.

Contains ExploreView, ExploreMatchesView, and the shared _run_explore_filter helper.
"""

import re
from collections import defaultdict

from django.db.models import Prefetch
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Match, Participant, Unit, UnitUsage
from ..services.cache import VersionedCache
from ..services.cdragon import (
    TRAIT_API_NAME_MAP,
    TRAIT_CACHE,
    ensure_trait_cache,
)
from ..services.items import get_item_canonical_map
from .helpers import cc, get_queue, get_tier, pbe_participant_filter

# ── Per-module caches ─────────────────────────────────────────────────────────

_explore_base_cache: dict[tuple, list[dict]] = {}  # (server, game_version) -> participant dicts
_explore_cache_version: dict[str, int] = {}


# ── Shared explore filter logic ──────────────────────────────────────────────

def _run_explore_filter(request):
    """
    Parse explore filter params from request, apply to cached participant data,
    return dict with filtered participants and base stats.

    Shared by ExploreView and ExploreMatchesView.
    """
    server = request.query_params.get("server", "PBE").upper()
    game_version = request.query_params.get("game_version")
    tier = get_tier(request)
    queue = get_queue(request)
    include_trait_stats = request.query_params.get("include_trait_stats") == "1"
    require_units = set(request.query_params.getlist("require_unit"))
    ban_units = set(request.query_params.getlist("ban_unit"))
    require_items_raw = request.query_params.getlist("require_item_on_unit")
    require_items_any = set(request.query_params.getlist("require_item"))
    exclude_items = set(request.query_params.getlist("exclude_item"))
    player_levels_raw = request.query_params.getlist("player_level")
    player_levels = {int(v) for v in player_levels_raw if v.isdigit()}

    require_items: list[tuple[str, str]] = []
    for raw in require_items_raw:
        if "::" in raw:
            unit_id, item_id = raw.split("::", 1)
            require_items.append((unit_id, item_id))

    require_traits: dict[str, int] = {}
    for raw in request.query_params.getlist("require_trait"):
        idx = raw.rfind(":")
        if idx > 0:
            name, min_u = raw[:idx].strip(), 1
            try:
                min_u = max(1, int(raw[idx + 1:]))
            except ValueError:
                pass
        else:
            name, min_u = raw.strip(), 1
        if name:
            require_traits[name.lower()] = max(require_traits.get(name.lower(), 1), min_u)

    def _parse_unit_int(param_key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for raw in request.query_params.getlist(param_key):
            idx = raw.rfind(":")
            if idx < 0:
                continue
            unit_id, count_str = raw[:idx].strip(), raw[idx + 1:]
            try:
                out[unit_id] = int(count_str)
            except ValueError:
                pass
        return out

    def _parse_trait_int(param_key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for raw in request.query_params.getlist(param_key):
            idx = raw.rfind(":")
            if idx < 0:
                continue
            name, count_str = raw[:idx].strip(), raw[idx + 1:]
            try:
                out[name.lower()] = int(count_str)
            except ValueError:
                pass
        return out

    exclude_unit_counts = _parse_unit_int("exclude_unit_count")
    require_unit_counts = _parse_unit_int("require_unit_count")
    require_unit_stars = {k: max(1, min(v, 3)) for k, v in _parse_unit_int("require_unit_star").items()}
    require_unit_item_counts = {k: max(0, min(v, 3)) for k, v in _parse_unit_int("require_unit_item_count").items()}
    excluded_traits = _parse_trait_int("exclude_trait")
    require_trait_tiers = _parse_trait_int("require_trait_tier")
    require_trait_max_tiers = _parse_trait_int("require_trait_max_tier")

    needs_trait_data = bool(require_traits or excluded_traits or require_trait_tiers or require_trait_max_tiers or include_trait_stats)

    if needs_trait_data:
        ensure_trait_cache(server)

    global _explore_base_cache, _explore_cache_version
    match_count = Match.objects.filter(server=server).count()
    cache_key = (server, game_version or "", queue or "", tier or "")
    if match_count != _explore_cache_version.get(server, -1):
        stale_keys = [k for k in _explore_base_cache if k[0] == server]
        for k in stale_keys:
            _explore_base_cache.pop(k, None)
        _explore_cache_version[server] = match_count

    if cache_key in _explore_base_cache:
        participants = _explore_base_cache[cache_key]
    else:
        participants = ExploreView._build_participant_data(game_version, server, queue, tier)
        _explore_base_cache[cache_key] = participants

    _server_api_name_map = TRAIT_API_NAME_MAP.get(server, {})

    def _trait_matches(req_lower: str, api_name: str) -> bool:
        if req_lower in api_name.lower():
            return True
        display = _server_api_name_map.get(api_name, "")
        return bool(display and req_lower in display.lower())

    def _max_trait_units(p_data: dict, req_lower: str) -> int:
        matched = 0
        for name, cnt in p_data["trait_unit_counts"].items():
            if _trait_matches(req_lower, name):
                matched = max(matched, cnt)
        if matched == 0:
            for name, cnt in p_data.get("derived_trait_counts", {}).items():
                if _trait_matches(req_lower, name):
                    matched = max(matched, cnt)
        return matched

    def _trait_tier(p_data: dict, req_lower: str) -> int:
        for name, tier in p_data.get("trait_tiers", {}).items():
            if _trait_matches(req_lower, name):
                return tier
        return 0

    _server_trait_cache = TRAIT_CACHE.get(server, {})

    def _breakpoint_tier(display_name: str, min_units: int) -> int:
        tdata = _server_trait_cache.get(display_name)
        if not tdata:
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

    _require_trait_tier_map: dict[str, int] = {}
    if require_traits and needs_trait_data:
        for trait_lower, min_u in require_traits.items():
            if min_u > 1:
                _require_trait_tier_map[trait_lower] = _breakpoint_tier(trait_lower, min_u)

    cmap = get_item_canonical_map()
    require_items = [(u, cmap.get(i, i)) for u, i in require_items]
    require_items_any = {cmap.get(i, i) for i in require_items_any}
    exclude_items = {cmap.get(i, i) for i in exclude_items}

    def matches(p_data: dict) -> bool:
        unit_set = p_data["unit_set"]
        unit_items = p_data["unit_items"]
        if player_levels and p_data["level"] not in player_levels:
            return False
        if not require_units.issubset(unit_set):
            return False
        if ban_units & unit_set:
            return False
        for unit_id, item_id in require_items:
            if unit_id not in unit_items or item_id not in unit_items[unit_id]:
                return False
        if require_items_any:
            all_items_set: set = set()
            for item_set in unit_items.values():
                all_items_set |= item_set
            if not require_items_any.issubset(all_items_set):
                return False
        if exclude_items:
            all_items: set = set()
            for item_set in unit_items.values():
                all_items |= item_set
            if all_items & exclude_items:
                return False
        if require_traits:
            for trait_lower, min_u in require_traits.items():
                req_tier = _require_trait_tier_map.get(trait_lower, 0)
                if req_tier > 0:
                    board_tier = _trait_tier(p_data, trait_lower)
                    if board_tier < req_tier:
                        return False
                else:
                    if _max_trait_units(p_data, trait_lower) < min_u:
                        return False
        if require_trait_tiers:
            for trait_lower, min_tier in require_trait_tiers.items():
                board_tier = _trait_tier(p_data, trait_lower)
                if board_tier < min_tier:
                    return False
                max_tier = require_trait_max_tiers.get(trait_lower, 0)
                if max_tier > 0 and board_tier > max_tier:
                    return False
        if exclude_unit_counts:
            for unit_id, min_count in exclude_unit_counts.items():
                if p_data["unit_count_by_unit"].get(unit_id, 0) >= min_count:
                    return False
        if require_unit_counts:
            for unit_id, min_count in require_unit_counts.items():
                if p_data["unit_count_by_unit"].get(unit_id, 0) < min_count:
                    return False
        if require_unit_stars:
            for unit_id, min_star in require_unit_stars.items():
                if p_data["unit_max_star_by_unit"].get(unit_id, 0) < min_star:
                    return False
        if require_unit_item_counts:
            for unit_id, min_items in require_unit_item_counts.items():
                if p_data["item_count_by_unit"].get(unit_id, 0) < min_items:
                    return False
        if excluded_traits:
            for trait_lower, threshold in excluded_traits.items():
                if _max_trait_units(p_data, trait_lower) >= threshold:
                    return False
        return True

    filtered = [p for p in participants if matches(p)]

    base_games = len(filtered)
    base_avg = round(sum(p["placement"] for p in filtered) / base_games, 2) if base_games else 0.0
    base_top4 = sum(1 for p in filtered if p["placement"] <= 4)
    base_wins = sum(1 for p in filtered if p["placement"] == 1)
    base_top4_rate = round(base_top4 / base_games, 4) if base_games else 0.0
    base_win_rate = round(base_wins / base_games, 4) if base_games else 0.0

    return {
        "filtered": filtered,
        "base_games": base_games,
        "base_avg": base_avg,
        "base_top4_rate": base_top4_rate,
        "base_win_rate": base_win_rate,
        "require_units": require_units,
        "require_unit_counts": require_unit_counts,
        "include_trait_stats": include_trait_stats,
        "server": server,
    }


# ── View classes ──────────────────────────────────────────────────────────────

class ExploreView(APIView):
    """
    GET /api/explore/

    Filters participants by comp conditions and returns per-unit and per-item
    placement stats for matching comps.

    Query params (all repeatable):
      game_version          -- optional version filter
      require_unit          -- unit character_id that MUST appear in comp
      ban_unit              -- unit character_id that must NOT appear in comp
      require_item_on_unit  -- "unit_id::item_id" -- unit must carry this item
      exclude_item          -- item_id that must not appear on ANY unit in comp
      player_level          -- exact player level to include (repeatable; OR logic)
      require_trait         -- "TraitName" or "TraitName:MinUnits"
      exclude_unit_count    -- "UnitId:MinCount" -- exclude if unit appears >= MinCount times
      require_unit_count    -- "UnitId:MinCount" -- unit must appear >= MinCount times
      require_unit_star     -- "UnitId:MinStar" -- unit must reach star level >= MinStar
      require_unit_item_count -- "UnitId:MinItems" -- unit must carry >= MinItems items
      exclude_trait          -- "TraitName:Threshold" -- exclude boards where trait has >= Threshold active units
    """

    @staticmethod
    def _build_participant_data(game_version: str | None, server: str = "PBE", queue: str | None = None, tier: str | None = None) -> list[dict]:
        """Build pre-processed participant dicts (cacheable, filter-independent)."""
        cmap = get_item_canonical_map()
        unit_traits_map: dict[str, list] = dict(
            Unit.objects.values_list("character_id", "traits")
        )

        qs = Participant.objects.filter(match__server=server)
        if server == "PBE" and queue == "project_pbe":
            qs = qs.filter(match__match_category="PROJECT_PBE", counts_for_stats=True)
            if tier:
                qs = qs.filter(match__match_tier=tier)
        elif server == "PBE" and queue == "pro_random":
            qs = qs.filter(match__match_category="PRO_RANDOM", counts_for_stats=True)
        else:
            qs = qs.filter(player__isnull=False)
            if tier:
                qs = qs.filter(player__tier=tier)
        if game_version:
            qs = qs.filter(match__game_version=game_version)
        # Defer raw_json to avoid loading ~22KB per match in the JOIN;
        # load it separately as a dict keyed by match_id.
        qs = qs.select_related("match", "player").defer("match__raw_json").prefetch_related(
            Prefetch(
                "unit_usages",
                queryset=UnitUsage.objects.select_related("unit"),
            )
        )

        match_ids = set()
        participants_raw = list(qs)
        for p in participants_raw:
            match_ids.add(p.match_id)
        raw_jsons: dict[str, dict] = dict(
            Match.objects.filter(match_id__in=match_ids).values_list(
                "match_id", "raw_json"
            )
        )

        match_participant_cache: dict[str, dict[str, dict]] = {}
        participants: list[dict] = []
        for p in participants_raw:
            unit_map: dict[str, set] = {}
            unit_count_by_unit: dict[str, int] = {}
            unit_max_star_by_unit: dict[str, int] = {}
            item_count_by_unit: dict[str, int] = {}
            for uu in p.unit_usages.all():
                if not uu.unit_id or not uu.unit or not uu.unit.character_id:
                    continue
                char_id = uu.unit.character_id
                unit_map[char_id] = {
                    cmap.get(i, i) for i in (uu.items or []) if i
                }
                item_count_by_unit[char_id] = max(
                    item_count_by_unit.get(char_id, 0),
                    len(uu.items or []),
                )
                unit_count_by_unit[char_id] = (
                    unit_count_by_unit.get(char_id, 0) + 1
                )
                unit_max_star_by_unit[char_id] = max(
                    unit_max_star_by_unit.get(char_id, 0),
                    int(uu.star_level or 0),
                )

            p_data: dict = {
                "pk": p.pk,
                "match_id": p.match_id,
                "game_datetime": p.match.game_datetime,
                "game_version": p.match.game_version,
                "player_str": str(p.player) if p.player else (p.puuid[:12] if p.puuid else "Unknown"),
                "player_tier": p.player.tier if p.player else None,
                "placement": p.placement,
                "level": p.level,
                "unit_set": set(unit_map.keys()),
                "unit_items": unit_map,
                "unit_count_by_unit": unit_count_by_unit,
                "unit_max_star_by_unit": unit_max_star_by_unit,
                "item_count_by_unit": item_count_by_unit,
                "trait_unit_counts": {},
                "derived_trait_counts": {},
                "trait_tiers": {},
            }

            # Trait data from raw_json
            trait_unit_counts: dict[str, int] = {}
            trait_tiers: dict[str, int] = {}
            match_map = match_participant_cache.get(p.match_id)
            if match_map is None:
                rj = raw_jsons.get(p.match_id) or {}
                pp_list = rj.get("info", {}).get("participants", [])
                match_map = {
                    str(pp.get("puuid", "")): pp
                    for pp in pp_list
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
                            trait_unit_counts[name] = max(
                                int(num_units),
                                trait_unit_counts.get(name, 0),
                            )
                            if tier_current > 0:
                                trait_tiers[name] = max(
                                    tier_current,
                                    trait_tiers.get(name, 0),
                                )
            p_data["trait_unit_counts"] = trait_unit_counts
            p_data["trait_tiers"] = trait_tiers
            derived: dict[str, int] = defaultdict(int)
            for uid, cnt in unit_count_by_unit.items():
                for t in unit_traits_map.get(uid) or []:
                    t_name = str(t).strip()
                    if t_name:
                        derived[t_name] += cnt
            p_data["derived_trait_counts"] = dict(derived)

            participants.append(p_data)
        return participants

    def get(self, request):
        ctx = _run_explore_filter(request)
        filtered = ctx["filtered"]
        base_games = ctx["base_games"]
        base_avg = ctx["base_avg"]
        base_top4_rate = ctx["base_top4_rate"]
        base_win_rate = ctx["base_win_rate"]
        require_units = ctx["require_units"]
        require_unit_counts = ctx["require_unit_counts"]
        include_trait_stats = ctx["include_trait_stats"]
        server = ctx["server"]

        # Per-unit stats across filtered comps
        unit_agg: dict = defaultdict(lambda: {"games": 0, "total": 0, "top4": 0, "wins": 0})
        for p in filtered:
            for unit_id in p["unit_set"]:
                unit_agg[unit_id]["games"] += 1
                unit_agg[unit_id]["total"] += p["placement"]
                if p["placement"] <= 4:
                    unit_agg[unit_id]["top4"] += 1
                if p["placement"] == 1:
                    unit_agg[unit_id]["wins"] += 1

        unit_stats = []
        for unit_id, agg in unit_agg.items():
            g = agg["games"]
            avg_p = round(agg["total"] / g, 2) if g else 0.0
            unit_stats.append({
                "unit_name": unit_id,
                "games": g,
                "avg_placement": avg_p,
                "top4_rate": round(agg["top4"] / g, 4) if g else 0.0,
                "win_rate": round(agg["wins"] / g, 4) if g else 0.0,
                "delta": round(avg_p - base_avg, 2),
            })
        unit_stats.sort(key=lambda x: -x["games"])

        # Per required-unit "Nth copy" stats
        # For each required unit, show stats for having N+1 copies
        unit_count_stats = []
        if require_units:
            current_req_counts = {u: require_unit_counts.get(u, 1) for u in require_units}
            for unit_id in require_units:
                current_count = current_req_counts[unit_id]
                for next_count in (current_count + 1, current_count + 2):
                    if next_count > 3:
                        break
                    games = 0
                    total = 0
                    top4 = 0
                    wins = 0
                    for p in filtered:
                        if p["unit_count_by_unit"].get(unit_id, 0) >= next_count:
                            games += 1
                            total += p["placement"]
                            if p["placement"] <= 4:
                                top4 += 1
                            if p["placement"] == 1:
                                wins += 1
                    if games > 0:
                        avg_p = round(total / games, 2)
                        unit_count_stats.append({
                            "unit_name": unit_id,
                            "count": next_count,
                            "games": games,
                            "avg_placement": avg_p,
                            "top4_rate": round(top4 / games, 4),
                            "win_rate": round(wins / games, 4),
                            "delta": round(avg_p - base_avg, 2),
                        })

        # Per (unit, item) stats across filtered comps
        item_agg: dict = defaultdict(lambda: {"games": 0, "total": 0, "top4": 0, "wins": 0})
        for p in filtered:
            for unit_id, items in p["unit_items"].items():
                for item in items:
                    if not item:
                        continue
                    item_agg[(unit_id, item)]["games"] += 1
                    item_agg[(unit_id, item)]["total"] += p["placement"]
                    if p["placement"] <= 4:
                        item_agg[(unit_id, item)]["top4"] += 1
                    if p["placement"] == 1:
                        item_agg[(unit_id, item)]["wins"] += 1

        item_stats = []
        for (unit_id, item_id), agg in item_agg.items():
            g = agg["games"]
            avg_p = round(agg["total"] / g, 2) if g else 0.0
            item_stats.append({
                "unit_name": unit_id,
                "item_name": item_id,
                "games": g,
                "avg_placement": avg_p,
                "top4_rate": round(agg["top4"] / g, 4) if g else 0.0,
                "win_rate": round(agg["wins"] / g, 4) if g else 0.0,
                "delta": round(avg_p - base_avg, 2),
            })
        item_stats.sort(key=lambda x: -x["games"])

        # Per (trait, tier) stats across filtered comps
        trait_stats = []
        if include_trait_stats:
            ensure_trait_cache(server)
            trait_agg: dict = defaultdict(lambda: {"games": 0, "total": 0, "top4": 0, "wins": 0, "num_units_sum": 0})
            for p in filtered:
                for trait_name, tier in p.get("trait_tiers", {}).items():
                    if tier <= 0:
                        continue
                    num_units = p["trait_unit_counts"].get(trait_name, 0)
                    key = (trait_name, tier)
                    trait_agg[key]["games"] += 1
                    trait_agg[key]["total"] += p["placement"]
                    trait_agg[key]["num_units_sum"] += num_units
                    if p["placement"] <= 4:
                        trait_agg[key]["top4"] += 1
                    if p["placement"] == 1:
                        trait_agg[key]["wins"] += 1

            for (trait_name, tier), agg in trait_agg.items():
                g = agg["games"]
                avg_p = round(agg["total"] / g, 2) if g else 0.0
                display_name = TRAIT_API_NAME_MAP.get(server, {}).get(trait_name, re.sub(r'^Set\d+_', '', trait_name))
                trait_stats.append({
                    "trait_name": display_name,
                    "tier": tier,
                    "num_units": round(agg["num_units_sum"] / g) if g else 0,
                    "games": g,
                    "avg_placement": avg_p,
                    "top4_rate": round(agg["top4"] / g, 4) if g else 0.0,
                    "win_rate": round(agg["wins"] / g, 4) if g else 0.0,
                    "delta": round(avg_p - base_avg, 2),
                })
            trait_stats.sort(key=lambda x: -x["games"])

        response_data = {
            "base_games": base_games,
            "base_avg_placement": base_avg,
            "base_top4_rate": base_top4_rate,
            "base_win_rate": base_win_rate,
            "unit_stats": unit_stats,
            "unit_count_stats": unit_count_stats,
            "item_stats": item_stats,
        }
        if include_trait_stats:
            response_data["trait_stats"] = trait_stats
        return cc(Response(response_data), 300)


class ExploreMatchesView(APIView):
    """
    GET /api/explore/matches/

    Returns actual match boards that match explore filter conditions.
    Same filter params as /api/explore/, plus pagination.

    Extra query params:
      limit  -- max results per page (default 20, max 100)
      offset -- skip first N results (default 0)
      sort   -- recency (default) | placement
    """

    def get(self, request):
        ctx = _run_explore_filter(request)
        filtered = ctx["filtered"]

        try:
            limit = max(1, min(100, int(request.query_params.get("limit", 20))))
        except ValueError:
            limit = 20
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except ValueError:
            offset = 0
        sort = request.query_params.get("sort", "recency")

        if sort == "placement":
            filtered.sort(key=lambda p: (p["placement"], -(p["game_datetime"].timestamp() if hasattr(p["game_datetime"], "timestamp") else 0)))
        else:
            filtered.sort(key=lambda p: p["game_datetime"], reverse=True)

        total = len(filtered)
        page = filtered[offset:offset + limit]

        if not page:
            return Response({"total": total, "results": []})

        # Fetch full participant data for the page
        pks = [p["pk"] for p in page]
        qs = Participant.objects.filter(pk__in=pks).select_related(
            "match", "player"
        ).prefetch_related(
            Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
        )
        pk_map = {p.pk: p for p in qs}

        results = []
        for p_data in page:
            p = pk_map.get(p_data["pk"])
            if not p:
                continue
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
            results.append({
                "match_id": p.match.match_id,
                "game_datetime": p.match.game_datetime,
                "game_version": p.match.game_version,
                "placement": p.placement,
                "level": p.level,
                "player": player_name,
                "units": units_out,
            })

        return Response({"total": total, "results": results})
