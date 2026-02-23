"""
Check all tracked players for active TFT games via the Spectator v5 API
and update the LiveGame table.

Pattern: async functions for HTTP only, sync functions for DB only.
"""

import asyncio
import datetime
import logging
import os

import httpx

from tracker.services.riot_api import RiotAPIService

logger = logging.getLogger(__name__)


async def _fetch_active_games_async(
    api_key: str,
    puuids: list[str],
) -> list[dict]:
    """
    Check all puuids for active games.
    Returns list of raw spectator API responses (only non-None).
    Pure HTTP — no Django ORM.
    """
    service = RiotAPIService(api_key)
    results: list[dict] = []

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), follow_redirects=True
    ) as client:
        tasks = [service.get_active_game(client, puuid) for puuid in puuids]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    for resp in responses:
        if isinstance(resp, Exception):
            logger.warning("Exception checking active game: %s", resp)
            continue
        if resp is not None:
            results.append(resp)

    return results


def check_live_games() -> int:
    """
    Main entry point (synchronous).
    Checks all tracked players for live games and replaces LiveGame table.
    Returns the number of live games found, or -1 on fetch failure.
    """
    from tracker.models import LiveGame, Player

    api_key = os.environ.get("RIOT_API_KEY", "").strip()
    if not api_key:
        logger.error("RIOT_API_KEY is not set.")
        return 0

    players = list(Player.objects.filter(puuid__isnull=False).exclude(puuid=""))
    if not players:
        logger.warning("No players with PUUIDs in DB.")
        return 0

    puuid_to_player = {p.puuid: p for p in players}
    puuids = list(puuid_to_player.keys())

    # Async HTTP calls only
    try:
        raw_games = asyncio.run(_fetch_active_games_async(api_key, puuids))
    except Exception as exc:
        logger.error("Failed to fetch active games: %s", exc)
        return -1

    # Group by game_id to deduplicate
    games_by_id: dict[str, dict] = {}
    for game_data in raw_games:
        game_id = str(game_data.get("gameId", ""))
        if not game_id:
            continue
        if game_id not in games_by_id:
            games_by_id[game_id] = game_data

    # Build LiveGame rows
    live_game_rows = []
    for game_id, game_data in games_by_id.items():
        game_start_ms = game_data.get("gameStartTime", 0)
        game_start = datetime.datetime.fromtimestamp(
            game_start_ms / 1000.0, tz=datetime.timezone.utc
        )

        participants = []
        pro_count = 0
        for p in game_data.get("participants", []):
            puuid = p.get("puuid", "")
            player = puuid_to_player.get(puuid)
            is_tracked = player is not None
            if is_tracked:
                pro_count += 1
                riot_id = f"{player.game_name}#{player.tag_line}"
            else:
                riot_id = p.get("riotId", puuid[:12])

            participants.append({
                "puuid": puuid,
                "riot_id": riot_id,
                "is_tracked": is_tracked,
            })

        live_game_rows.append(LiveGame(
            game_id=game_id,
            game_start_time=game_start,
            participants=participants,
            pro_player_count=pro_count,
        ))

    # Atomic replace: delete old, create current
    LiveGame.objects.all().delete()
    if live_game_rows:
        LiveGame.objects.bulk_create(live_game_rows)

    logger.info("Live games updated: %d active game(s).", len(live_game_rows))
    return len(live_game_rows)
