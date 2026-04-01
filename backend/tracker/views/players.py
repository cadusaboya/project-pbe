"""
Views for player profiles, player lists, and player rankings.
"""

from collections import defaultdict

from django.db.models import Avg, Count, Prefetch, Q, Sum
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Participant, Player, UnitUsage
from ..services.cache import VersionedCache
from .helpers import cc

# ── Per-module caches ─────────────────────────────────────────────────────────

_players_cache = VersionedCache()


class PlayerProfileView(APIView):
    """
    GET /api/player/<player_name>/profile/

    Returns full profile data for a player: overall stats, last 20 games,
    most used units, and full match history.

    player_name is matched case-insensitively against game_name.
    """

    def get(self, request, player_name: str):
        server = request.query_params.get("server", "PBE").upper()

        # Filter player by region matching the server to avoid name collisions
        if server == "SCRIMS":
            player = Player.objects.filter(game_name__iexact=player_name, region="SCRIMS").first()
        elif server == "PBE":
            player = Player.objects.filter(game_name__iexact=player_name, region="PBE").first()
        else:
            player = (
                Player.objects.filter(game_name__iexact=player_name)
                .exclude(region="PBE")
                .exclude(region="SCRIMS")
                .first()
            )
        if not player:
            return Response({"error": "Player not found"}, status=404)

        game_version = request.query_params.get("game_version")

        participations = (
            Participant.objects.filter(player=player, match__server=server)
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
        server = request.query_params.get("server", "PBE").upper()
        if server == "SCRIMS":
            players = Player.objects.filter(region="SCRIMS")
        elif server == "PBE":
            players = Player.objects.filter(puuid__isnull=False, region="PBE").exclude(puuid="")
        else:
            players = Player.objects.filter(puuid__isnull=False).exclude(puuid="").exclude(region="PBE").exclude(region="SCRIMS")
        player_count = players.count()
        cached = _players_cache.get((server,), player_count)
        if cached is not None:
            return cc(Response(cached), 300)
        result = []
        for p in players:
            result.append({
                "game_name": p.game_name,
                "tag_line": p.tag_line,
                "region": p.region,
            })
        result.sort(key=lambda x: x["game_name"].lower())
        _players_cache.set((server,), result, player_count)
        return cc(Response(result), 300)


class PlayerStatsView(APIView):
    """
    GET /api/player-stats/

    Returns aggregated stats for all tracked players:
    games, avg_placement, top4_rate, win_rate, and top 5 most common units.

    Query params:
      sort  -- games | avg_placement (default) | win_rate | top4_rate
      search -- case-insensitive substring on game_name
      min_games -- exclude players below this threshold
      game_version -- filter matches by game version
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        sort_key = request.query_params.get("sort", "avg_placement")
        search = request.query_params.get("search", "").strip()
        min_games = int(request.query_params.get("min_games", 0) or 0)
        game_version = request.query_params.get("game_version")

        if server == "SCRIMS":
            players = Player.objects.filter(region="SCRIMS")
        elif server == "PBE":
            players = Player.objects.filter(puuid__isnull=False, region="PBE").exclude(puuid="")
        else:
            players = Player.objects.filter(puuid__isnull=False).exclude(puuid="").exclude(region="PBE").exclude(region="SCRIMS")
        if search:
            players = players.filter(game_name__icontains=search)

        # Build participation filter for this server + optional game_version
        part_filter = Q(participations__match__server=server)
        if game_version:
            part_filter &= Q(participations__match__game_version=game_version)

        # Push aggregation to database instead of loading all objects into Python
        players = players.annotate(
            total_games=Count("participations", filter=part_filter),
            total_placement=Sum("participations__placement", filter=part_filter),
            top4_count=Count("participations", filter=part_filter & Q(participations__placement__lte=4)),
            win_count=Count("participations", filter=part_filter & Q(participations__placement=1)),
        ).filter(total_games__gt=0)

        if min_games > 0:
            players = players.filter(total_games__gte=min_games)

        # Fetch top 5 units only for players that pass the filter
        player_ids = list(players.values_list("pk", flat=True))

        # Build a lookup: player_id → top 5 units
        top_units_lookup: dict[int, list] = defaultdict(list)
        if player_ids:
            unit_qs = (
                UnitUsage.objects.filter(
                    participant__player_id__in=player_ids,
                    participant__match__server=server,
                )
                .values("participant__player_id", "unit__character_id", "unit__cost")
                .annotate(games=Count("id"))
            )
            if game_version:
                unit_qs = unit_qs.filter(participant__match__game_version=game_version)

            # Group by player, pick top 5
            player_unit_counts: dict[int, list] = defaultdict(list)
            for row in unit_qs:
                player_unit_counts[row["participant__player_id"]].append({
                    "character_id": row["unit__character_id"],
                    "cost": row["unit__cost"],
                    "games": row["games"],
                })
            for pid, units in player_unit_counts.items():
                units.sort(key=lambda x: -x["games"])
                top_units_lookup[pid] = units[:5]

        result = []
        for player in players:
            total_games = player.total_games
            total_placement = player.total_placement or 0
            result.append({
                "game_name": player.game_name,
                "tag_line": player.tag_line,
                "games": total_games,
                "avg_placement": round(total_placement / total_games, 2),
                "top4_rate": round(player.top4_count / total_games, 3),
                "win_rate": round(player.win_count / total_games, 3),
                "top_units": top_units_lookup.get(player.pk, []),
            })

        # Sort
        if sort_key in ("games", "win_rate", "top4_rate"):
            result.sort(key=lambda x: x[sort_key], reverse=True)
        else:
            result.sort(key=lambda x: x["avg_placement"])

        return cc(Response(result), 300)
