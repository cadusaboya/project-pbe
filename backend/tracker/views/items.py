"""
Views for item assets and per-unit item statistics.
"""

from collections import defaultdict

from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import UnitUsage
from ..services.items import get_item_canonical_map, load_item_assets, load_item_names
from .helpers import cc


class ItemAssetsView(APIView):
    """GET /api/item-assets/ -- returns {assets: {id: url}, names: {id: display_name}}."""

    def get(self, request):
        assets = load_item_assets()
        names = load_item_names()
        return cc(Response({"assets": assets, "names": names}), 300)


class ItemStatsView(APIView):
    """
    GET /api/item-stats/

    Returns per-item placement stats for a specific unit.

    Query params:
      unit          -- required: unit character_id (e.g. TFT16_Lissandra)
      game_version  -- optional: filter to a specific game version
      min_games     -- optional: exclude items below this game count
      selected_item -- repeatable: lock in 1 or 2 items; base becomes their
                       combined AVP and table shows the next item to add
    """

    def get(self, request):
        unit_name = request.query_params.get("unit")
        if not unit_name:
            return Response({"error": "unit parameter is required"}, status=400)

        game_version = request.query_params.get("game_version")
        selected_items = request.query_params.getlist("selected_item")  # 0-2 entries
        selected_set = set(selected_items)
        min_games_raw = request.query_params.get("min_games")
        min_games = None
        if min_games_raw:
            try:
                min_games = int(min_games_raw)
            except ValueError:
                pass

        server = request.query_params.get("server", "PBE").upper()
        qs = UnitUsage.objects.filter(
            unit__character_id=unit_name,
            participant__match__server=server,
        ).select_related("participant")
        if server == "LIVE":
            qs = qs.filter(participant__player__isnull=False)
        if game_version:
            qs = qs.filter(participant__match__game_version=game_version)

        usages = list(qs.values("items", "participant__placement"))

        # Resolve item IDs to canonical to merge duplicates
        cmap = get_item_canonical_map()

        # Narrow to usages that contain ALL locked items (empty set = no filter)
        # Resolve selected_items to canonical IDs for matching
        canonical_selected = {cmap.get(s, s) for s in selected_items}
        filtered = [
            u for u in usages
            if canonical_selected.issubset({cmap.get(i, i) for i in (u["items"] or [])})
        ]

        base_games = len(filtered)
        base_total = sum(u["participant__placement"] for u in filtered)
        base_avg = round(base_total / base_games, 2) if base_games else 0.0

        # Aggregate candidate items -- skip any already locked
        item_agg: dict = defaultdict(lambda: {"games": 0, "total": 0, "top4": 0, "wins": 0})
        for u in filtered:
            placement = u["participant__placement"]
            for item in (u["items"] or []):
                if not item:
                    continue
                canonical = cmap.get(item, item)
                if canonical in canonical_selected:
                    continue
                item_agg[canonical]["games"] += 1
                item_agg[canonical]["total"] += placement
                if placement <= 4:
                    item_agg[canonical]["top4"] += 1
                if placement == 1:
                    item_agg[canonical]["wins"] += 1

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
