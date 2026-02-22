import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path
import datetime

from django.conf import settings
from django.db.models import Count, Prefetch, Q, Sum
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AggregatedUnitStat, Comp, Match, Participant, Player, Unit, UnitUsage
from .serializers import UnitStatSerializer, WinningCompSerializer

_ITEM_ASSETS_FILE = Path(settings.BASE_DIR) / "item_assets.json"

_SORT_MAP = {
    "avg_placement": "avg_placement",
    "games": "-games",
    "win_rate": "-win_rate",
    "top4_rate": "-top4_rate",
}


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
    """GET /api/item-assets/ — returns {item_id: image_url} mapping from CDragon."""

    def get(self, request):
        try:
            data = json.loads(_ITEM_ASSETS_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = {}
        return Response(data)


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
    """

    def get(self, request):
        game_version = request.query_params.get("game_version")
        require_units = set(request.query_params.getlist("require_unit"))
        ban_units = set(request.query_params.getlist("ban_unit"))
        require_items_raw = request.query_params.getlist("require_item_on_unit")
        exclude_items = set(request.query_params.getlist("exclude_item"))

        # Parse "unit_id::item_id" strings
        require_items: list[tuple[str, str]] = []
        for raw in require_items_raw:
            if "::" in raw:
                unit_id, item_id = raw.split("::", 1)
                require_items.append((unit_id, item_id))

        qs = Participant.objects.all()
        if game_version:
            qs = qs.filter(match__game_version=game_version)
        qs = qs.prefetch_related(
            Prefetch("unit_usages", queryset=UnitUsage.objects.select_related("unit"))
        )

        # Build Python-friendly data for each participant
        participants = []
        for p in qs:
            unit_map: dict[str, set] = {}
            for uu in p.unit_usages.all():
                unit_map[uu.unit.character_id] = set(uu.items or [])
            participants.append({
                "placement": p.placement,
                "unit_set": set(unit_map.keys()),
                "unit_items": unit_map,
            })

        def matches(p_data: dict) -> bool:
            unit_set = p_data["unit_set"]
            unit_items = p_data["unit_items"]
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
            return True

        filtered = [p for p in participants if matches(p)]

        base_games = len(filtered)
        base_avg = round(sum(p["placement"] for p in filtered) / base_games, 2) if base_games else 0.0

        # Per-unit stats across filtered comps
        unit_agg: dict = defaultdict(lambda: {"games": 0, "total": 0})
        for p in filtered:
            for unit_id in p["unit_set"]:
                unit_agg[unit_id]["games"] += 1
                unit_agg[unit_id]["total"] += p["placement"]

        unit_stats = []
        for unit_id, agg in unit_agg.items():
            g = agg["games"]
            avg_p = round(agg["total"] / g, 2) if g else 0.0
            unit_stats.append({
                "unit_name": unit_id,
                "games": g,
                "avg_placement": avg_p,
                "delta": round(avg_p - base_avg, 2),
            })
        unit_stats.sort(key=lambda x: -x["games"])

        # Per (unit, item) stats across filtered comps
        item_agg: dict = defaultdict(lambda: {"games": 0, "total": 0})
        for p in filtered:
            for unit_id, items in p["unit_items"].items():
                for item in items:
                    if not item:
                        continue
                    item_agg[(unit_id, item)]["games"] += 1
                    item_agg[(unit_id, item)]["total"] += p["placement"]

        item_stats = []
        for (unit_id, item_id), agg in item_agg.items():
            g = agg["games"]
            avg_p = round(agg["total"] / g, 2) if g else 0.0
            item_stats.append({
                "unit_name": unit_id,
                "item_name": item_id,
                "games": g,
                "avg_placement": avg_p,
                "delta": round(avg_p - base_avg, 2),
            })
        item_stats.sort(key=lambda x: -x["games"])

        return Response({
            "base_games": base_games,
            "base_avg_placement": base_avg,
            "unit_stats": unit_stats,
            "item_stats": item_stats,
        })


class HiddenCompsView(APIView):
    """
    GET /api/comps/hidden/

    Returns the most common discovered core compositions and their best flex add-ons.

    Query params:
      game_version â€“ optional version filter
      limit        â€“ number of core comps to return (default 20)
      core_size    â€“ core comp size (default 5)
      flex_size    â€“ flex combo size (default 3)
      top_flex     â€“ number of flex combos per core (default 3)
    """

    def get(self, request):
        game_version = request.query_params.get("game_version")
        try:
            limit = max(1, int(request.query_params.get("limit", 20)))
        except ValueError:
            limit = 20
        try:
            core_size = max(1, int(request.query_params.get("core_size", 5)))
        except ValueError:
            core_size = 5
        try:
            flex_size = max(1, int(request.query_params.get("flex_size", 3)))
        except ValueError:
            flex_size = 3
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
            if len(units) < core_size:
                continue
            unit_set = set(units)
            all_units |= unit_set
            boards.append({
                "match_id": p.match_id,
                "placement": p.placement,
                "units": units,
                "unit_set": unit_set,
            })

        if not boards:
            return Response([])

        unit_cost_map = dict(
            Unit.objects.filter(character_id__in=all_units).values_list("character_id", "cost")
        )

        core_stats: dict[tuple[str, ...], dict] = defaultdict(
            lambda: {"count": 0, "total_placement": 0, "matches": set()}
        )
        for b in boards:
            for core in combinations(b["units"], core_size):
                row = core_stats[core]
                row["count"] += 1
                row["total_placement"] += b["placement"]
                row["matches"].add(b["match_id"])

        ranked_cores = sorted(
            core_stats.items(),
            key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
        )[:limit]

        result = []
        for core_units, core_info in ranked_cores:
            core_set = set(core_units)
            flex_stats: dict[tuple[str, ...], dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0, "matches": set()}
            )

            for b in boards:
                if not core_set.issubset(b["unit_set"]):
                    continue
                remaining = sorted(b["unit_set"] - core_set)
                if len(remaining) < flex_size:
                    continue
                for flex in combinations(remaining, flex_size):
                    row = flex_stats[flex]
                    row["count"] += 1
                    row["total_placement"] += b["placement"]
                    row["matches"].add(b["match_id"])

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]

            result.append({
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
        try:
            limit = max(1, int(request.query_params.get("limit", 20)))
        except ValueError:
            limit = 20
        try:
            top_flex = max(1, int(request.query_params.get("top_flex", 3)))
        except ValueError:
            top_flex = 3

        comps = list(Comp.objects.filter(is_active=True).order_by("name")[:limit])
        if not comps:
            return Response([])

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
            unit_set = {
                uu.unit.character_id
                for uu in p.unit_usages.all()
                if uu.unit_id and uu.unit and uu.unit.character_id
            }
            if not unit_set:
                continue
            boards.append({
                "match_id": p.match_id,
                "placement": p.placement,
                "unit_set": unit_set,
            })
            all_units |= unit_set

        if not boards:
            return Response([])

        unit_cost_map = dict(
            Unit.objects.filter(character_id__in=all_units).values_list("character_id", "cost")
        )

        result = []
        for comp in comps:
            raw_units = comp.units if isinstance(comp.units, list) else []
            core_units = sorted({str(u).strip() for u in raw_units if str(u).strip()})
            if not core_units:
                continue
            core_set = set(core_units)
            raw_excluded = comp.excluded_units if isinstance(comp.excluded_units, list) else []
            excluded_set = {str(u).strip() for u in raw_excluded if str(u).strip()}

            target_level = max(1, min(int(comp.target_level or 8), 10))
            if len(core_units) >= target_level:
                # Completed board at this level: suggest next +1 until level 10.
                flex_size = 1 if target_level < 10 else 0
            else:
                flex_size = target_level - len(core_units)

            core_count = 0
            core_total_placement = 0
            core_matches = set()
            flex_stats: dict[tuple[str, ...], dict] = defaultdict(
                lambda: {"count": 0, "total_placement": 0, "matches": set()}
            )

            for b in boards:
                if excluded_set and (excluded_set & b["unit_set"]):
                    continue
                if not core_set.issubset(b["unit_set"]):
                    continue
                core_count += 1
                core_total_placement += b["placement"]
                core_matches.add(b["match_id"])

                remaining = sorted(b["unit_set"] - core_set)
                if flex_size == 0 or len(remaining) < flex_size:
                    continue
                for flex in combinations(remaining, flex_size):
                    row = flex_stats[flex]
                    row["count"] += 1
                    row["total_placement"] += b["placement"]
                    row["matches"].add(b["match_id"])

            if core_count == 0:
                continue

            ranked_flex = sorted(
                flex_stats.items(),
                key=lambda kv: (-kv[1]["count"], (kv[1]["total_placement"] / kv[1]["count"]), kv[0]),
            )[:top_flex]

            result.append({
                "name": comp.name,
                "target_level": target_level,
                "core_units": [
                    {"character_id": u, "cost": unit_cost_map.get(u, 0)}
                    for u in core_units
                ],
                "comps": core_count,
                "matches": len(core_matches),
                "avg_placement": round(core_total_placement / core_count, 2),
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

        result.sort(key=lambda x: (-x["comps"], x["avg_placement"], x["name"]))
        return Response(result[:limit])


class VersionsView(APIView):
    """GET /api/versions/ — list distinct game versions stored in DB."""

    def get(self, request):
        versions = (
            Match.objects.values_list("game_version", flat=True)
            .distinct()
            .order_by("game_version")
        )
        return Response(list(versions))
