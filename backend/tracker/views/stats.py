"""
Views for data versioning, global stats, game versions, and unit statistics.
"""

from collections import defaultdict

from django.db.models import Count, Max, Q, Sum
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import AggregatedUnitStat, Match, Participant, Player, UnitUsage
from ..serializers import UnitStatSerializer
from ..services.cache import VersionedCache
from ..services.items import get_item_canonical_map
from .helpers import SORT_MAP, cc, get_tier

# ── Per-module caches ─────────────────────────────────────────────────────────

_versions_cache = VersionedCache()


class DataVersionView(APIView):
    """GET /api/data-version/ -- lightweight data version for cache busting."""

    def get(self, request):
        return cc(Response({"data_version": Match.objects.count()}), 30)


class StatsView(APIView):
    """GET /api/stats/"""

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        game_version = request.query_params.get("game_version")
        tier = get_tier(request)
        match_qs = Match.objects.filter(server=server)
        if game_version:
            match_qs = match_qs.filter(game_version=game_version)

        if server == "SCRIMS":
            players_count = 0
            last_run = None
        elif server == "PBE":
            player_qs = Player.objects.filter(puuid__isnull=False, region="PBE").exclude(puuid="")
            if tier:
                player_qs = player_qs.filter(tier=tier)
            players_count = player_qs.count()
            last_polled = player_qs.aggregate(latest=Max("last_polled_at"))["latest"]
            last_run = last_polled.isoformat() if last_polled else None
        else:
            player_qs = Player.objects.filter(puuid__isnull=False).exclude(puuid="").exclude(region="PBE")
            if tier:
                player_qs = player_qs.filter(tier=tier)
            players_count = player_qs.count()
            last_polled = player_qs.aggregate(latest=Max("last_polled_at"))["latest"]
            last_run = last_polled.isoformat() if last_polled else None

        participant_qs = Participant.objects.filter(match__server=server, player__isnull=False)
        if tier:
            participant_qs = participant_qs.filter(player__tier=tier)
        if game_version:
            participant_qs = participant_qs.filter(match__game_version=game_version)

        return cc(Response({
            "matches_analyzed": match_qs.count(),
            "players_tracked": players_count,
            "participants_recorded": participant_qs.count(),
            "last_fetch_at": last_run,
            "data_version": Match.objects.count(),
        }), 15)


class VersionsView(APIView):
    """GET /api/versions/ -- list distinct game versions stored in DB."""

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        match_count = Match.objects.filter(server=server).count()
        cached = _versions_cache.get((server,), match_count)
        if cached is not None:
            return cc(Response(cached), 300)
        versions = list(
            Match.objects.filter(server=server)
            .values_list("game_version", flat=True)
            .distinct()
            .order_by("-game_version")
        )
        _versions_cache.set((server,), versions, match_count)
        return cc(Response(versions), 300)


class UnitStatsView(ListAPIView):
    """
    GET /api/unit-stats/

    Query params:
      sort         -- avg_placement (default) | games | win_rate | top4_rate
      min_games    -- only include units with at least this many games
      search       -- case-insensitive substring match on character_id
      game_version -- filter stats to a specific game version (computes on-the-fly)
    """

    serializer_class = UnitStatSerializer

    def list(self, request, *args, **kwargs):
        game_version = request.query_params.get("game_version")
        if game_version:
            return self._stats_for_version(request, game_version)
        return super().list(request, *args, **kwargs)

    def _stats_for_version(self, request, game_version: str):
        server = request.query_params.get("server", "PBE").upper()
        tier = get_tier(request)
        min_games = request.query_params.get("min_games")
        search = request.query_params.get("search")
        sort_key = request.query_params.get("sort", "avg_placement")

        qs = UnitUsage.objects.filter(
            participant__match__game_version=game_version,
            participant__match__server=server,
            participant__player__isnull=False,
        )
        if tier:
            qs = qs.filter(participant__player__tier=tier)
        qs = (
            qs.values("unit__character_id", "unit__cost", "unit__traits")
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
        server = self.request.query_params.get("server", "PBE").upper()
        qs = AggregatedUnitStat.objects.filter(server=server).select_related("unit")

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
        order_field = SORT_MAP.get(sort_key, "avg_placement")
        return qs.order_by(order_field)


class UnitStarStatsView(APIView):
    """
    GET /api/unit-stats/<unit_name>/star-stats/

    Returns avg placement, top4 rate, win rate and games broken down
    by star level (1, 2, 3) for a single unit.

    Query params:
      game_version -- optional, filter to a specific version
    """

    def get(self, request, unit_name: str):
        server = request.query_params.get("server", "PBE").upper()
        tier = get_tier(request)
        qs = UnitUsage.objects.filter(
            unit__character_id=unit_name,
            participant__match__server=server,
            participant__player__isnull=False,
        )
        if tier:
            qs = qs.filter(participant__player__tier=tier)

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

        # Item stats -- aggregate per item name from the JSONField list
        cmap = get_item_canonical_map()
        item_agg: dict = defaultdict(lambda: {"games": 0, "total_placement": 0, "top4_count": 0, "win_count": 0})
        for usage in qs.select_related("participant"):
            placement = usage.participant.placement
            for item in (usage.items or []):
                if not item:
                    continue
                canonical = cmap.get(item, item)
                item_agg[canonical]["games"] += 1
                item_agg[canonical]["total_placement"] += placement
                if placement <= 4:
                    item_agg[canonical]["top4_count"] += 1
                if placement == 1:
                    item_agg[canonical]["win_count"] += 1

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
