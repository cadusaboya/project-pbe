"""
Views for CDragon data: traits, champions, and match lobby.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Match, Player, Unit
from ..services.cdragon import (
    ensure_champions_cache,
    ensure_trait_cache,
)
from .helpers import cc


class TraitDataView(APIView):
    """
    GET /api/traits/

    Returns trait breakpoints and CDragon icon URLs for all TFT traits.
    Response: { "TraitName": { "breakpoints": [2, 4, 6], "icon": "https://..." }, ... }

    Result is cached in-process for 1 hour.
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        traits = ensure_trait_cache(server)
        return cc(Response(traits), 300)


class ChampionsView(APIView):
    """
    GET /api/champions/

    Returns all Set 16 champions from CDragon with apiName, name, cost, traits.
    Cached in-process for 1 hour.
    """

    def get(self, request):
        server = request.query_params.get("server", "PBE").upper()
        champions = ensure_champions_cache(server)
        return cc(Response(champions), 300)


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

        # puuid -> "GameName#TAG" for tracked players
        puuids = [p.get("puuid", "") for p in participants_data if p.get("puuid")]
        players_by_puuid = {
            p.puuid: str(p)
            for p in Player.objects.filter(puuid__in=puuids)
        }

        # character_id -> Unit for cost / traits
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
