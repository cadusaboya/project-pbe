import json
from pathlib import Path
import datetime

from django.conf import settings
from django.db.models import Count, Q, Sum
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AggregatedUnitStat, Match, Participant, Player, Unit, UnitUsage
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
        last_run = None
        latest_match = Match.objects.order_by("-game_datetime").first()
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
            "matches_analyzed": Match.objects.count(),
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


class VersionsView(APIView):
    """GET /api/versions/ — list distinct game versions stored in DB."""

    def get(self, request):
        versions = (
            Match.objects.values_list("game_version", flat=True)
            .distinct()
            .order_by("game_version")
        )
        return Response(list(versions))
