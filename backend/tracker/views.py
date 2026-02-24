import json
import re
import time
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
import datetime

import httpx
from django.conf import settings
from django.db.models import Count, Prefetch, Q, Sum
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AggregatedUnitStat, Comp, Match, Participant, Player, Unit, UnitUsage
from .serializers import UnitStatSerializer, WinningCompSerializer

_ITEM_ASSETS_FILE = Path(settings.BASE_DIR) / "item_assets.json"
_ITEM_NAMES_FILE = Path(settings.BASE_DIR) / "item_names.json"
_CDRAGON_TFT_URL = "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json"
_TRAIT_CACHE: dict | None = None
_TRAIT_CACHE_TS: float = 0.0
_TRAIT_CACHE_TTL = 3600.0  # seconds
_TRAIT_API_NAME_MAP: dict[str, str] = {}  # apiName -> displayName (e.g. "TFT16_Sorcerer" -> "Arcanist")

_CHAMPIONS_CACHE: list | None = None
_CHAMPIONS_CACHE_TS: float = 0.0

# In-memory caches for data that rarely changes
_ITEM_ASSETS_CACHE: dict | None = None
_ITEM_NAMES_CACHE: dict | None = None
_VERSIONS_CACHE: list | None = None
_VERSIONS_CACHE_TS: float = 0.0
_PLAYERS_CACHE: list | None = None
_PLAYERS_CACHE_TS: float = 0.0
_COMPS_CACHE: dict[tuple, dict] = {}
_COMPS_CACHE_TS: float = 0.0
_CACHE_TTL_SHORT = 300.0  # 5 minutes


def _cc(response: Response, max_age: int) -> Response:
    """Set Cache-Control header on a DRF Response."""
    response["Cache-Control"] = f"public, max-age={max_age}"
    return response

_SORT_MAP = {
    "avg_placement": "avg_placement",
    "games": "-games",
    "win_rate": "-win_rate",
    "top4_rate": "-top4_rate",
}


def _unit_slot_weight(character_id: str) -> int:
    """Board slot weight rules for special units."""
    name = str(character_id or "").strip().lower()
    if not name:
        return 1
    if "atakhan" in name or name.endswith("_galio"):
        return 0
    if "baron" in name:
        return 2
    return 1


def _slots_used(units: list[str] | tuple[str, ...]) -> int:
    return sum(_unit_slot_weight(u) for u in units)


def _weighted_flex_combos(unit_pool: list[str], target_slots: int) -> set[tuple[str, ...]]:
    """
    Return unique combos (sorted tuple) from unit_pool whose total slot weight
    matches target_slots. unit_pool may contain duplicates.
    """
    if target_slots < 0:
        return set()
    if target_slots == 0:
        return {tuple()}

    pool = list(unit_pool)
    combos: set[tuple[str, ...]] = set()

    def backtrack(idx: int, picked: list[str], slots: int):
        if slots == target_slots:
            combos.add(tuple(sorted(picked)))
            return
        if idx >= len(pool) or slots > target_slots:
            return

        # Option 1: skip current unit
        backtrack(idx + 1, picked, slots)

        # Option 2: include current unit
        unit_id = pool[idx]
        w = _unit_slot_weight(unit_id)
        if slots + w <= target_slots:
            picked.append(unit_id)
            backtrack(idx + 1, picked, slots + w)
            picked.pop()

    backtrack(0, [], 0)
    return combos


def _ensure_trait_cache() -> dict:
    """Populate _TRAIT_CACHE and _TRAIT_API_NAME_MAP from CDragon if stale."""
    global _TRAIT_CACHE, _TRAIT_CACHE_TS, _TRAIT_API_NAME_MAP

    now = time.time()
    if _TRAIT_CACHE is not None and (now - _TRAIT_CACHE_TS) < _TRAIT_CACHE_TTL:
        return _TRAIT_CACHE

    try:
        with httpx.Client(timeout=120) as client:
            resp = client.get(_CDRAGON_TFT_URL)
            resp.raise_for_status()
            data = resp.json()

        traits: dict = {}
        api_map: dict[str, str] = {}
        current_set = data.get("sets", {}).get("16", {})
        for trait in current_set.get("traits", []):
            name = trait.get("name")
            if not name:
                continue
            api_name = trait.get("apiName", "")
            breakpoints = [
                e["minUnits"]
                for e in (trait.get("effects") or [])
                if e.get("minUnits", 0) > 0
            ]
            if not breakpoints:
                continue
            raw_icon = trait.get("icon", "")
            icon = ""
            if raw_icon:
                icon = (
                    "https://raw.communitydragon.org/pbe/game/"
                    + raw_icon.replace("ASSETS/", "assets/")
                              .replace(".tex", ".png")
                              .lower()
                )
            traits[name] = {"breakpoints": breakpoints, "icon": icon}
            if api_name:
                api_map[api_name] = name

        _TRAIT_CACHE = traits
        _TRAIT_CACHE_TS = now
        _TRAIT_API_NAME_MAP = api_map
    except Exception:
        if _TRAIT_CACHE is None:
            _TRAIT_CACHE = {}

    return _TRAIT_CACHE


class TraitDataView(APIView):
    """
    GET /api/traits/

    Returns trait breakpoints and CDragon icon URLs for all TFT traits.
    Response: { "TraitName": { "breakpoints": [2, 4, 6], "icon": "https://..." }, ... }

    Result is cached in-process for 1 hour.
    """

    def get(self, request):
        traits = _ensure_trait_cache()
        return _cc(Response(traits), 300)


class ChampionsView(APIView):
    """
    GET /api/champions/

    Returns all Set 16 champions from CDragon with apiName, name, cost, traits.
    Cached in-process for 1 hour.
    """

    def get(self, request):
        global _CHAMPIONS_CACHE, _CHAMPIONS_CACHE_TS

        now = time.time()
        if _CHAMPIONS_CACHE is not None and (now - _CHAMPIONS_CACHE_TS) < _TRAIT_CACHE_TTL:
            return _cc(Response(_CHAMPIONS_CACHE), 300)

        try:
            with httpx.Client(timeout=120) as client:
                resp = client.get(_CDRAGON_TFT_URL)
                resp.raise_for_status()
                data = resp.json()

            champions = []
            current_set = data.get("sets", {}).get("16", {})
            for champ in current_set.get("champions", []):
                api_name: str = champ.get("apiName", "")
                if not api_name:
                    continue
                champions.append({
                    "apiName": api_name,
                    "name": champ.get("name", api_name.replace("TFT16_", "")),
                    "cost": champ.get("cost", 0),
                    "traits": champ.get("traits", []),
                })

            champions.sort(key=lambda c: (c["cost"], c["name"]))
            _CHAMPIONS_CACHE = champions
            _CHAMPIONS_CACHE_TS = now
        except Exception:
            if _CHAMPIONS_CACHE is None:
                _CHAMPIONS_CACHE = []

        return _cc(Response(_CHAMPIONS_CACHE), 300)


class UnitStatsView(ListAPIView):
    """
    GET /api/unit-stats/

    Query params:
      sort         – avg_placement (default) | games | win_rate | top4_rate
      min_games    – only include units with at least this many games
      search       – case-insensitive substring match on character_id
      game_version – filter stats to a specific game version (computes on-the-fly)
    """

    serializer_class = UnitStatSerializer

    def list(self, request, *args, **kwargs):
        game_version = request.query_params.get("game_version")
        if game_version:
            return self._stats_for_version(request, game_version)
        return super().list(request, *args, **kwargs)

    def _stats_for_version(self, request, game_version: str):
        min_games = request.query_params.get("min_games")
        search = request.query_params.get("search")
        sort_key = request.query_params.get("sort", "avg_placement")

        qs = (
            UnitUsage.objects.filter(participant__match__game_version=game_version)
            .values("unit__character_id", "unit__cost", "unit__traits")
            .annotate(
                games=Count("id"),
                total_placement=Sum("participant__placement"),
                top4_count=Count("id", filter=Q(participant__placement__lte=4)),
                win_count=Count("id", filter=Q(participant__placement=1)),
            )
        )

        if search:
            qs = qs.filter(unit__character_id__icontains=search.strip())

        results = []
        for row in qs:
            games = row["games"]
            total = row["total_placement"] or 0
            results.append({
                "unit_name": row["unit__character_id"],
                "cost": row["unit__cost"],
                "traits": row["unit__traits"],
                "games": games,
                "avg_placement": total / games if games else 0.0,
                "top4_rate": row["top4_count"] / games if games else 0.0,
                "win_rate": row["win_count"] / games if games else 0.0,
            })

        if min_games:
            try:
                threshold = int(min_games)
                results = [r for r in results if r["games"] >= threshold]
            except ValueError:
                pass

        _sort_cfg = {
            "avg_placement": ("avg_placement", False),
            "games": ("games", True),
            "win_rate": ("win_rate", True),
            "top4_rate": ("top4_rate", True),
        }
        sort_field, reverse = _sort_cfg.get(sort_key, ("avg_placement", False))
        results.sort(key=lambda x: x[sort_field], reverse=reverse)

        return Response(results)

    def get_queryset(self):
        qs = AggregatedUnitStat.objects.select_related("unit").all()

        min_games = self.request.query_params.get("min_games")
        if min_games:
            try:
                qs = qs.filter(games__gte=int(min_games))
            except ValueError:
                pass

        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(unit__character_id__icontains=search.strip())

        sort_key = self.request.query_params.get("sort", "avg_placement")
        order_field = _SORT_MAP.get(sort_key, "avg_placement")
        return qs.order_by(order_field)


class StatsView(APIView):
    """GET /api/stats/"""

    def get(self, request):
        game_version = request.query_params.get("game_version")
        match_qs = Match.objects.all()
        if game_version:
            match_qs = match_qs.filter(game_version=game_version)

        last_run = None
        latest_match = match_qs.order_by("-game_datetime").first()
        if latest_match:
            info = (latest_match.raw_json or {}).get("info", {})
            game_length_s = info.get("game_length") or 0
            try:
                game_length_s = max(float(game_length_s), 0.0)
            except (TypeError, ValueError):
                game_length_s = 0.0

            game_start = latest_match.game_datetime
            if game_start.tzinfo is None:
                game_start = game_start.replace(tzinfo=datetime.timezone.utc)

            game_end = game_start.astimezone(datetime.timezone.utc) + datetime.timedelta(
                seconds=game_length_s
            )
            last_run = game_end.isoformat()

        return Response({
            "matches_analyzed": match_qs.count(),
            "players_tracked": Player.objects.filter(puuid__isnull=False).exclude(puuid="").count(),
            "participants_recorded": Participant.objects.count(),
            "last_fetch_at": last_run,
        })


class ItemAssetsView(APIView):
    """GET /api/item-assets/ — returns {assets: {id: url}, names: {id: display_name}}."""

    def get(self, request):
        global _ITEM_ASSETS_CACHE, _ITEM_NAMES_CACHE
        if _ITEM_ASSETS_CACHE is None:
            try:
                _ITEM_ASSETS_CACHE = json.loads(_ITEM_ASSETS_FILE.read_text(encoding="utf-8"))
            except FileNotFoundError:
                _ITEM_ASSETS_CACHE = {}
        if _ITEM_NAMES_CACHE is None:
            try:
                _ITEM_NAMES_CACHE = json.loads(_ITEM_NAMES_FILE.read_text(encoding="utf-8"))
            except FileNotFoundError:
                _ITEM_NAMES_CACHE = {}
        return _cc(Response({"assets": _ITEM_ASSETS_CACHE, "names": _ITEM_NAMES_CACHE}), 300)


class MatchLobbyView(APIView):
    """
    GET /api/match/<match_id>/lobby/

    Returns all 8 participants for a match parsed from raw_json,
    enriched with cost/traits from the Unit table and names from Player table.
    """

    def get(self, request, match_id):
        try:
            match = Match.objects.get(match_id=match_id)
        except Match.DoesNotExist:
            return Response({"error": "Match not found"}, status=404)

        participants_data = match.raw_json.get("info", {}).get("participants", [])

        # puuid → "GameName#TAG" for tracked players
        puuids = [p.get("puuid", "") for p in participants_data if p.get("puuid")]
        players_by_puuid = {
            p.puuid: str(p)
            for p in Player.objects.filter(puuid__in=puuids)
        }

        # character_id → Unit for cost / traits
        all_char_ids = {
            u.get("character_id", "")
            for p in participants_data
            for u in p.get("units", [])
            if u.get("character_id")
        }
        units_by_id = {u.character_id: u for u in Unit.objects.filter(character_id__in=all_char_ids)}

        result = []
        for p_data in participants_data:
            puuid = p_data.get("puuid", "")

            if puuid in players_by_puuid:
                name = players_by_puuid[puuid]
            else:
                game_name = p_data.get("riotIdGameName", "")
                tag_line = p_data.get("riotIdTagline", "")
                name = f"{game_name}#{tag_line}" if game_name else puuid[:12]

            units = []
            for u_data in p_data.get("units", []):
                char_id = u_data.get("character_id", "")
                unit_obj = units_by_id.get(char_id)
                rarity = u_data.get("rarity", 0)
                cost = unit_obj.cost if unit_obj else (7 if rarity == 6 else rarity + 1)
                traits = unit_obj.traits if unit_obj else []
                units.append({
                    "character_id": char_id,
                    "star_level": u_data.get("tier", 1),
                    "cost": cost,
                    "traits": traits,
                    "items": u_data.get("itemNames", []),
                })

            result.append({
                "name": name,
                "placement": p_data.get("placement", 0),
                "level": p_data.get("level", 1),
                "gold_left": p_data.get("gold_left", 0),
                "units": units,
                "augments": p_data.get("augments", []),
            })

        result.sort(key=lambda x: x["placement"])
        return Response(result)


class WinningCompsView(ListAPIView):
    """
    GET /api/winning-comps/

    Returns the 1st-place composition for each stored match.

    Query params:
      limit – number of results (default 50)
    """

    serializer_class = WinningCompSerializer

    def get_queryset(self):
        try:
            limit = int(self.request.query_params.get("limit", 50))
        except ValueError:
            limit = 50

        qs = (
            Participant.objects.filter(placement=1)
            .select_related("match", "player")
            .prefetch_related("unit_usages__unit")
            .order_by("-match__game_datetime")
        )

        game_version = self.request.query_params.get("game_version")
        if game_version:
            qs = qs.filter(match__game_version=game_version)

        return qs[:limit]


class UnitStarStatsView(APIView):
    """
    GET /api/unit-stats/<unit_name>/star-stats/

    Returns avg placement, top4 rate, win rate and games broken down
    by star level (1, 2, 3) for a single unit.

    Query params:
      game_version – optional, filter to a specific version
    """

    def get(self, request, unit_name: str):
        qs = UnitUsage.objects.filter(unit__character_id=unit_name)

        game_version = request.query_params.get("game_version")
        if game_version:
            qs = qs.filter(participant__match__game_version=game_version)

        # Star stats
        star_rows = (
            qs.values("star_level")
            .annotate(
                games=Count("id"),
                total_placement=Sum("participant__placement"),
                top4_count=Count("id", filter=Q(participant__placement__lte=4)),
                win_count=Count("id", filter=Q(participant__placement=1)),
            )
            .order_by("star_level")
        )

        star_result = []
        for row in star_rows:
            games = row["games"]
            total = row["total_placement"] or 0
            star_result.append({
                "star_level": row["star_level"],
                "games": games,
                "avg_placement": round(total / games, 2) if games else 0.0,
                "top4_rate": round(row["top4_count"] / games, 3) if games else 0.0,
                "win_rate": round(row["win_count"] / games, 3) if games else 0.0,
            })

        # Item stats — aggregate per item name from the JSONField list
        item_agg: dict = defaultdict(lambda: {"games": 0, "total_placement": 0, "top4_count": 0, "win_count": 0})
        for usage in qs.select_related("participant"):
            placement = usage.participant.placement
            for item in (usage.items or []):
                if not item:
                    continue
                item_agg[item]["games"] += 1
                item_agg[item]["total_placement"] += placement
                if placement <= 4:
                    item_agg[item]["top4_count"] += 1
                if placement == 1:
                    item_agg[item]["win_count"] += 1

        sorted_items = sorted(item_agg.items(), key=lambda x: x[1]["games"], reverse=True)[:6]
        item_result = []
        for item_name, stats in sorted_items:
            games = stats["games"]
            item_result.append({
                "item_name": item_name,
                "games": games,
                "avg_placement": round(stats["total_placement"] / games, 2) if games else 0.0,
                "top4_rate": round(stats["top4_count"] / games, 3) if games else 0.0,
                "win_rate": round(stats["win_count"] / games, 3) if games else 0.0,
            })

        return Response({"star_stats": star_result, "item_stats": item_result})


class ItemStatsView(APIView):
    """
    GET /api/item-stats/

    Returns per-item placement stats for a specific unit.

    Query params:
      unit          – required: unit character_id (e.g. TFT16_Lissandra)
      game_version  – optional: filter to a specific game version
      min_games     – optional: exclude items below this game count
      selected_item – repeatable: lock in 1 or 2 items; base becomes their
                      combined AVP and table shows the next item to add
    """

    def get(self, request):
        unit_name = request.query_params.get("unit")
        if not unit_name:
            return Response({"error": "unit parameter is required"}, status=400)

        game_version = request.query_params.get("game_version")
        selected_items = request.query_params.getlist("selected_item")  # 0–2 entries
        selected_set = set(selected_items)
        min_games_raw = request.query_params.get("min_games")
        min_games = None
        if min_games_raw:
            try:
                min_games = int(min_games_raw)
            except ValueError:
                pass

        qs = UnitUsage.objects.filter(unit__character_id=unit_name).select_related("participant")
        if game_version:
            qs = qs.filter(participant__match__game_version=game_version)

        usages = list(qs.values("items", "participant__placement"))

        # Narrow to usages that contain ALL locked items (empty set = no filter)
        filtered = [
            u for u in usages
            if selected_set.issubset(set(u["items"] or []))
        ]

        base_games = len(filtered)
        base_total = sum(u["participant__placement"] for u in filtered)
        base_avg = round(base_total / base_games, 2) if base_games else 0.0

        # Aggregate candidate items — skip any already locked
        item_agg: dict = defaultdict(lambda: {"games": 0, "total": 0, "top4": 0, "wins": 0})
        for u in filtered:
            placement = u["participant__placement"]
            for item in (u["items"] or []):
                if not item or item in selected_set:
                    continue
                item_agg[item]["games"] += 1
                item_agg[item]["total"] += placement
                if placement <= 4:
                    item_agg[item]["top4"] += 1
                if placement == 1:
                    item_agg[item]["wins"] += 1

        items = []
        for item_name, stats in item_agg.items():
            g = stats["games"]
            if min_games and g < min_games:
                continue
            avg_p = round(stats["total"] / g, 2) if g else 0.0
            items.append({
                "item_name": item_name,
                "games": g,
                "avg_placement": avg_p,
                "delta": round(avg_p - base_avg, 2),
                "top4_rate": round(stats["top4"] / g, 3) if g else 0.0,
                "win_rate": round(stats["wins"] / g, 3) if g else 0.0,
            })

        items.sort(key=lambda x: x["avg_placement"])

        return Response({
            "unit": unit_name,
            "base_games": base_games,
            "base_avg_placement": base_avg,
            "items": items,
        })


class ExploreView(APIView):
    """
    GET /api/explore/

    Filters participants by comp conditions and returns per-unit and per-item
    placement stats for matching comps.

    Query params (all repeatable):
      game_version          – optional version filter
      require_unit          – unit character_id that MUST appear in comp
      ban_unit              – unit character_id that must NOT appear in comp
      require_item_on_unit  – "unit_id::item_id" — unit must carry this item
      exclude_item          – item_id that must not appear on ANY unit in comp
      player_level          – exact player level to include (repeatable; OR logic)
      require_trait         – "TraitName" or "TraitName:MinUnits"
      exclude_unit_count    – "UnitId:MinCount" — exclude if unit appears >= MinCount times
      require_unit_count    – "UnitId:MinCount" — unit must appear >= MinCount times
      require_unit_star     – "UnitId:MinStar" — unit must reach star level >= MinStar
      require_unit_item_count – "UnitId:MinItems" — unit must carry >= MinItems items
      exclude_trait          – "TraitName:Threshold" — exclude boards where trait has >= Threshold active units
    """

    def get(self, request):
        game_version = request.query_params.get("game_version")
        include_trait_stats = request.query_params.get("include_trait_stats") == "1"
        require_units = set(request.query_params.getlist("require_unit"))
        ban_units = set(request.query_params.getlist("ban_unit"))
        require_items_raw = request.query_params.getlist("require_item_on_unit")
        exclude_items = set(request.query_params.getlist("exclude_item"))
        player_levels_raw = request.query_params.getlist("player_level")
        player_levels = {int(v) for v in player_levels_raw if v.isdigit()}

        # Parse "unit_id::item_id" strings
        require_items: list[tuple[str, str]] = []
        for raw in require_items_raw:
            if "::" in raw:
                unit_id, item_id = raw.split("::", 1)
                require_items.append((unit_id, item_id))

        # require_trait: "TraitName" or "TraitName:MinUnits" → {lowercase: min_units}
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
        require_trait_tiers = _parse_trait_int("require_trait_tier")  # {trait_lower: min_tier}
        require_trait_max_tiers = _parse_trait_int("require_trait_max_tier")  # {trait_lower: max_tier}

        needs_trait_data = bool(require_traits or excluded_traits or require_trait_tiers or require_trait_max_tiers or include_trait_stats)
        needs_extra_unit_data = bool(exclude_unit_counts or require_unit_counts or require_unit_stars or require_unit_item_counts or require_units)

        if needs_trait_data:
            _ensure_trait_cache()

        qs = Participant.objects.all()
        if game_version:
            qs = qs.filter(match__game_version=game_version)
        if needs_trait_data:
            qs = qs.select_related("match")
        qs = qs.prefetch_related(
            Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
        )

        unit_traits_map: dict[str, list] = {}
        if needs_trait_data:
            unit_traits_map = dict(Unit.objects.values_list("character_id", "traits"))

        match_participant_cache: dict[str, dict[str, dict]] = {}

        def _trait_matches(req_lower: str, api_name: str) -> bool:
            if req_lower in api_name.lower():
                return True
            display = _TRAIT_API_NAME_MAP.get(api_name, "")
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
            """Return the tier_current for a trait (case-insensitive substring match)."""
            for name, tier in p_data.get("trait_tiers", {}).items():
                if _trait_matches(req_lower, name):
                    return tier
            return 0

        # Build Python-friendly data for each participant
        participants = []
        for p in qs:
            unit_map: dict[str, set] = {}
            unit_count_by_unit: dict[str, int] = {}
            unit_max_star_by_unit: dict[str, int] = {}
            for uu in p.unit_usages.all():
                if not uu.unit_id or not uu.unit or not uu.unit.character_id:
                    continue
                char_id = uu.unit.character_id
                unit_map[char_id] = set(uu.items or [])
                if needs_extra_unit_data or needs_trait_data:
                    unit_count_by_unit[char_id] = unit_count_by_unit.get(char_id, 0) + 1
                    unit_max_star_by_unit[char_id] = max(
                        unit_max_star_by_unit.get(char_id, 0), int(uu.star_level or 0)
                    )

            p_data: dict = {
                "placement": p.placement,
                "level": p.level,
                "unit_set": set(unit_map.keys()),
                "unit_items": unit_map,
                "unit_count_by_unit": unit_count_by_unit,
                "unit_max_star_by_unit": unit_max_star_by_unit,
                "trait_unit_counts": {},
                "derived_trait_counts": {},
            }

            if needs_trait_data:
                trait_unit_counts: dict[str, int] = {}
                trait_tiers: dict[str, int] = {}
                match_map = match_participant_cache.get(p.match_id)
                if match_map is None:
                    pp_list = (p.match.raw_json or {}).get("info", {}).get("participants", [])
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
                                trait_unit_counts[name] = max(int(num_units), trait_unit_counts.get(name, 0))
                                if tier_current > 0:
                                    trait_tiers[name] = max(tier_current, trait_tiers.get(name, 0))
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
            if exclude_items:
                all_items: set = set()
                for item_set in unit_items.values():
                    all_items |= item_set
                if all_items & exclude_items:
                    return False
            if require_traits:
                for trait_lower, min_u in require_traits.items():
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
                    items = p_data["unit_items"].get(unit_id, set())
                    if len(items) < min_items:
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
            _ensure_trait_cache()
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
                display_name = _TRAIT_API_NAME_MAP.get(trait_name, re.sub(r'^Set\d+_', '', trait_name))
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
        return Response(response_data)


class HiddenCompsView(APIView):
    """
    GET /api/comps/hidden/

    Returns the most common discovered core compositions and their best flex add-ons.

    Query params:
      game_version â€“ optional version filter
      limit        â€“ number of core comps to return (default 20)
      core_sizes   â€“ comma-separated core sizes to analyze (default: 4,5,6)
      min_occurrences â€“ minimum frequency for a core to be considered (default: 100)
      target_level â€“ optional override for board level target; if omitted,
                     backend infers the most common completion level per core
      top_flex     â€“ number of flex combos per core (default 3)
    """

    def get(self, request):
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
            top_flex = max(1, int(request.query_params.get("top_flex", 3)))
        except ValueError:
            top_flex = 3

        participants = (
            Participant.objects.select_related("match")
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
            core_size_current = _slots_used(core_units)
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

            for b in boards:
                if not core_set.issubset(b["unit_set"]):
                    continue
                remaining = sorted(b["unit_set"] - core_set)
                for flex in _weighted_flex_combos(remaining, flex_size):
                    row = flex_stats[flex]
                    row["count"] += 1
                    row["total_placement"] += b["placement"]
                    row["matches"].add(b["match_id"])

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]

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
            })

        return Response(result)


class CompsView(APIView):
    """
    GET /api/comps/

    Returns stats for manually created comps from the Comp table,
    including best flex add-ons and AVP.

    Query params:
      game_version â€“ optional version filter
      limit        â€“ max number of comps to return (default 20)
      top_flex     â€“ number of flex combos per comp (default 3)
    """

    def get(self, request):
        game_version = request.query_params.get("game_version")
        limit_raw = request.query_params.get("limit")
        limit = None
        if limit_raw is not None:
            try:
                limit = max(1, int(limit_raw))
            except ValueError:
                limit = None
        try:
            top_flex = max(1, int(request.query_params.get("top_flex", 3)))
        except ValueError:
            top_flex = 3

        global _COMPS_CACHE, _COMPS_CACHE_TS
        now = time.time()
        cache_key = (game_version, limit, top_flex)
        if (now - _COMPS_CACHE_TS) < _CACHE_TTL_SHORT and cache_key in _COMPS_CACHE:
            return _cc(Response(_COMPS_CACHE[cache_key]), 300)

        comps_qs = Comp.objects.filter(is_active=True).order_by("name")
        if limit is not None:
            comps_qs = comps_qs[:limit]
        comps = list(comps_qs)
        if not comps:
            return Response([])
        comp_units_all: set[str] = set()
        for comp in comps:
            raw_units = comp.units if isinstance(comp.units, list) else []
            comp_units_all |= {str(u).strip() for u in raw_units if str(u).strip()}

        base_qs = Participant.objects.order_by("id")
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
                    raw = Match.objects.filter(pk=p.match_id).values_list("raw_json", flat=True).first()
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

        def _comp_trait_matches(req_lower: str, api_name: str) -> bool:
            if req_lower in api_name.lower():
                return True
            display = _TRAIT_API_NAME_MAP.get(api_name, "")
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

        _ensure_trait_cache()

        def _breakpoint_tier(display_name: str, min_units: int) -> int:
            """Convert a min_units value to a 1-based tier using CDragon breakpoints."""
            tdata = _TRAIT_CACHE.get(display_name)
            if not tdata:
                # Try case-insensitive match
                for dname, td in _TRAIT_CACHE.items():
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

            if not core_unit_counts:
                continue
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

            target_level = max(1, min(int(comp.target_level or 9), 10))
            core_size = sum(
                _unit_slot_weight(unit_id) * count
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
                board_flex_size = (b["level"] or 0) - core_size
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
                if board_flex_size <= 0:
                    continue
                for flex in _weighted_flex_combos(remaining_pool, board_flex_size):
                    row = flex_stats[flex]
                    row["count"] += 1
                    row["total_placement"] += b["placement"]
                    row["matches"].add(b["match_id"])

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]
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
            })

        total_games = len({b["match_id"] for b in boards})

        result.sort(key=lambda x: (-x["comps"], x["avg_placement"], x["name"]))
        comps_list = result[:limit] if limit is not None else result
        response_data = {"total_games": total_games, "comps": comps_list}
        if (now - _COMPS_CACHE_TS) >= _CACHE_TTL_SHORT:
            _COMPS_CACHE.clear()
            _COMPS_CACHE_TS = now
        _COMPS_CACHE[cache_key] = response_data
        return _cc(Response(response_data), 300)


class SearchCompsView(APIView):
    """
    GET /api/search-comps/

    Returns all participants whose comp contains ALL specified units.

    Query params:
      unit         – repeatable; case-insensitive substring on character_id
      game_version – optional version filter
      limit        – max results (default 200, max 500)
      sort         – recency (default) | placement
    """

    def get(self, request):
        units = [u.strip() for u in request.query_params.getlist("unit") if u.strip()]
        game_version = request.query_params.get("game_version")
        try:
            limit = max(1, min(500, int(request.query_params.get("limit", 200))))
        except ValueError:
            limit = 200
        sort = request.query_params.get("sort", "recency")

        qs = Participant.objects.select_related("match", "player").prefetch_related(
            Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
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
            result.append({
                "match_id": p.match.match_id,
                "game_datetime": p.match.game_datetime,
                "game_version": p.match.game_version,
                "placement": p.placement,
                "level": p.level,
                "player": player_name,
                "units": units_out,
            })

        return Response(result)


class PlayerProfileView(APIView):
    """
    GET /api/player/<player_name>/profile/

    Returns full profile data for a player: overall stats, last 20 games,
    most used units, and full match history.

    player_name is matched case-insensitively against game_name.
    """

    def get(self, request, player_name: str):
        player = Player.objects.filter(game_name__iexact=player_name).first()
        if not player:
            return Response({"error": "Player not found"}, status=404)

        game_version = request.query_params.get("game_version")

        participations = (
            Participant.objects.filter(player=player)
            .select_related("match")
            .prefetch_related(
                Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
            )
            .order_by("-match__game_datetime")
        )
        if game_version:
            participations = participations.filter(match__game_version=game_version)

        participations = list(participations)

        total_games = len(participations)
        if total_games == 0:
            return Response({
                "player": {"game_name": player.game_name, "tag_line": player.tag_line},
                "total_games": 0,
                "avg_placement": 0,
                "top4_rate": 0,
                "win_rate": 0,
                "last_20": [],
                "top_units": [],
                "match_history": [],
            })

        total_placement = sum(p.placement for p in participations)
        top4_count = sum(1 for p in participations if p.placement <= 4)
        win_count = sum(1 for p in participations if p.placement == 1)

        # Last 20 games
        last_20 = []
        for p in participations[:20]:
            last_20.append({
                "match_id": p.match.match_id,
                "game_datetime": p.match.game_datetime,
                "placement": p.placement,
            })

        # Most used units
        unit_agg: dict = defaultdict(lambda: {"games": 0, "total_placement": 0, "top4": 0, "wins": 0})
        for p in participations:
            for uu in p.unit_usages.all():
                if not uu.unit_id or not uu.unit:
                    continue
                char_id = uu.unit.character_id
                unit_agg[char_id]["games"] += 1
                unit_agg[char_id]["total_placement"] += p.placement
                if p.placement <= 4:
                    unit_agg[char_id]["top4"] += 1
                if p.placement == 1:
                    unit_agg[char_id]["wins"] += 1
                if "cost" not in unit_agg[char_id]:
                    unit_agg[char_id]["cost"] = uu.unit.cost

        top_units = []
        for char_id, stats in sorted(unit_agg.items(), key=lambda x: -x[1]["games"]):
            g = stats["games"]
            top_units.append({
                "character_id": char_id,
                "cost": stats.get("cost", 0),
                "games": g,
                "avg_placement": round(stats["total_placement"] / g, 2),
                "top4_rate": round(stats["top4"] / g, 3),
                "win_rate": round(stats["wins"] / g, 3),
            })

        # Match history (recent 50)
        match_history = []
        for p in participations[:50]:
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
            match_history.append({
                "match_id": p.match.match_id,
                "game_datetime": p.match.game_datetime,
                "game_version": p.match.game_version,
                "placement": p.placement,
                "level": p.level,
                "units": units_out,
            })

        return Response({
            "player": {"game_name": player.game_name, "tag_line": player.tag_line},
            "total_games": total_games,
            "avg_placement": round(total_placement / total_games, 2),
            "top4_rate": round(top4_count / total_games, 3),
            "win_rate": round(win_count / total_games, 3),
            "last_20": last_20,
            "top_units": top_units[:15],
            "match_history": match_history,
        })


class PlayerListView(APIView):
    """
    GET /api/players/

    Returns all tracked players with basic info.
    """

    def get(self, request):
        global _PLAYERS_CACHE, _PLAYERS_CACHE_TS
        now = time.time()
        if _PLAYERS_CACHE is not None and (now - _PLAYERS_CACHE_TS) < _CACHE_TTL_SHORT:
            return _cc(Response(_PLAYERS_CACHE), 300)
        players = Player.objects.filter(puuid__isnull=False).exclude(puuid="")
        result = []
        for p in players:
            result.append({
                "game_name": p.game_name,
                "tag_line": p.tag_line,
            })
        result.sort(key=lambda x: x["game_name"].lower())
        _PLAYERS_CACHE = result
        _PLAYERS_CACHE_TS = now
        return _cc(Response(result), 300)


class PlayerStatsView(APIView):
    """
    GET /api/player-stats/

    Returns aggregated stats for all tracked players:
    games, avg_placement, top4_rate, win_rate, and top 5 most common units.

    Query params:
      sort  — games | avg_placement (default) | win_rate | top4_rate
      search — case-insensitive substring on game_name
      min_games — exclude players below this threshold
    """

    def get(self, request):
        sort_key = request.query_params.get("sort", "avg_placement")
        search = request.query_params.get("search", "").strip()
        min_games = int(request.query_params.get("min_games", 0))

        players = Player.objects.filter(puuid__isnull=False).exclude(puuid="")
        if search:
            players = players.filter(game_name__icontains=search)

        players = players.prefetch_related(
            Prefetch(
                "participations",
                queryset=Participant.objects.prefetch_related(
                    Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
                ),
            )
        )

        result = []
        for player in players:
            participations = list(player.participations.all())
            total_games = len(participations)
            if total_games == 0 or total_games < min_games:
                continue

            total_placement = sum(p.placement for p in participations)
            top4_count = sum(1 for p in participations if p.placement <= 4)
            win_count = sum(1 for p in participations if p.placement == 1)

            # Top 5 most used units
            unit_counts: dict = defaultdict(lambda: {"games": 0, "cost": 0})
            for p in participations:
                for uu in p.unit_usages.all():
                    if not uu.unit_id or not uu.unit:
                        continue
                    char_id = uu.unit.character_id
                    unit_counts[char_id]["games"] += 1
                    if not unit_counts[char_id]["cost"]:
                        unit_counts[char_id]["cost"] = uu.unit.cost

            top_units = sorted(unit_counts.items(), key=lambda x: -x[1]["games"])[:5]
            top_units_out = [
                {"character_id": cid, "cost": data["cost"], "games": data["games"]}
                for cid, data in top_units
            ]

            result.append({
                "game_name": player.game_name,
                "tag_line": player.tag_line,
                "games": total_games,
                "avg_placement": round(total_placement / total_games, 2),
                "top4_rate": round(top4_count / total_games, 3),
                "win_rate": round(win_count / total_games, 3),
                "top_units": top_units_out,
            })

        # Sort
        reverse = sort_key != "avg_placement"
        if sort_key in ("games", "win_rate", "top4_rate"):
            result.sort(key=lambda x: x[sort_key], reverse=True)
        else:
            result.sort(key=lambda x: x["avg_placement"])

        return Response(result)


class VersionsView(APIView):
    """GET /api/versions/ — list distinct game versions stored in DB."""

    def get(self, request):
        global _VERSIONS_CACHE, _VERSIONS_CACHE_TS
        now = time.time()
        if _VERSIONS_CACHE is not None and (now - _VERSIONS_CACHE_TS) < _CACHE_TTL_SHORT:
            return _cc(Response(_VERSIONS_CACHE), 300)
        versions = list(
            Match.objects.values_list("game_version", flat=True)
            .distinct()
            .order_by("-game_version")
        )
        _VERSIONS_CACHE = versions
        _VERSIONS_CACHE_TS = now
        return _cc(Response(versions), 300)
