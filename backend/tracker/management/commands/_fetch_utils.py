"""Shared utilities for match-fetching management commands (fetch_pbe / fetch_live)."""
import asyncio
import datetime
import logging
from typing import Callable, Optional

import httpx

from tracker.models import Match, Player
from tracker.services.aggregation import recompute_unit_stats
from tracker.services.match_processor import process_match
from tracker.services.riot_api import RiotAPIService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Async helpers
# ---------------------------------------------------------------------------

async def fetch_match_ids_async(
    api_key: str,
    puuid: str,
    routing: str = "americas",
    count: int = 20,
    start_time: int | None = None,
) -> list[str]:
    """Fetch recent match IDs for a player."""
    service = RiotAPIService(api_key, routing=routing)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), follow_redirects=True
    ) as client:
        return await service.get_match_ids(
            client, puuid, count=count, start_time=start_time
        )


async def fetch_single_match_async(
    api_key: str,
    match_id: str,
    routing: str = "americas",
) -> Optional[dict]:
    """Fetch a single match by ID."""
    service = RiotAPIService(api_key, routing=routing)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), follow_redirects=True
    ) as client:
        return await service.get_match(client, match_id)


# ---------------------------------------------------------------------------
# Shared player loop
# ---------------------------------------------------------------------------

# Type alias for the per-match filter callback.
# Called with (match_data, puuid_to_player, command) and must return either:
#   - a dict with {"store": True, "game_version": "...", "game_start_utc": datetime}
#   - a dict with {"store": False, "stop": True/False} to skip or stop iteration
MatchFilterResult = dict


def process_player_matches(
    *,
    command,
    api_key: str,
    players: list[Player],
    puuid_to_player: dict[str, Player],
    server: str,
    get_routing: Callable[[Player], str],
    get_match_ids_kwargs: Callable[[Player], dict],
    filter_match: Callable[[dict, dict[str, Player]], MatchFilterResult],
    cooldown_seconds: int = 0,
) -> int:
    """
    Shared player-loop logic for match fetching commands.

    Args:
        command:              The Django management command instance (for stdout).
        api_key:              Riot API key.
        players:              List of Player objects to iterate.
        puuid_to_player:      {puuid: Player} map for all tracked players.
        server:               "PBE" or "LIVE".
        get_routing:          Callable(player) -> routing string for match fetching.
        get_match_ids_kwargs: Callable(player) -> extra kwargs for fetch_match_ids_async
                              (e.g. {"start_time": ...}).
        filter_match:         Callable(match_data, puuid_to_player) -> MatchFilterResult.
                              Must return a dict:
                                {"store": True, "game_version": str, "game_start_utc": datetime}
                              or:
                                {"store": False, "stop": bool}  (stop=True breaks the inner loop)
        cooldown_seconds:     Per-player poll cooldown (0 = disabled).

    Returns:
        Total number of newly stored matches.
    """
    total_stored = 0

    for i, player in enumerate(players, 1):
        label = f"[{i}/{len(players)}] {player}"
        if server == "LIVE":
            label += f" ({player.region})"

        now_utc = datetime.datetime.now(datetime.timezone.utc)

        # Cooldown check
        if (
            cooldown_seconds > 0
            and player.last_polled_at
            and (now_utc - player.last_polled_at).total_seconds() < cooldown_seconds
        ):
            command.stdout.write(f"  {label} - cooldown active, skipping API poll")
            continue

        routing = get_routing(player)
        extra_kwargs = get_match_ids_kwargs(player)

        match_ids = asyncio.run(
            fetch_match_ids_async(
                api_key, player.puuid, routing=routing, **extra_kwargs
            )
        )

        if not match_ids:
            command.stdout.write(f"  {label} - no matches, skipping")
            player.last_polled_at = now_utc
            player.save(update_fields=["last_polled_at"])
            continue

        # Checkpoint: only process matches newer than the last seen one.
        if player.last_seen_match_id and player.last_seen_match_id in match_ids:
            cut = match_ids.index(player.last_seen_match_id)
            candidate_ids = match_ids[:cut]
        else:
            candidate_ids = match_ids

        existing: set[str] = set(
            Match.objects.filter(match_id__in=candidate_ids).values_list(
                "match_id", flat=True
            )
        )
        new_ids = [mid for mid in candidate_ids if mid not in existing]

        if not candidate_ids:
            command.stdout.write(f"  {label} - no new IDs since checkpoint")
            player.last_seen_match_id = match_ids[0]
            player.last_polled_at = now_utc
            player.save(update_fields=["last_seen_match_id", "last_polled_at"])
            continue

        if not new_ids:
            command.stdout.write(
                f"  {label} - {len(candidate_ids)} candidate match(es), all already stored"
            )
            player.last_seen_match_id = match_ids[0]
            player.last_polled_at = now_utc
            player.save(update_fields=["last_seen_match_id", "last_polled_at"])
            continue

        command.stdout.write(
            f"  {label} - {len(candidate_ids)} candidate match(es), {len(new_ids)} to check"
        )
        had_fetch_fail = False

        for mid in new_ids:
            match_data = asyncio.run(
                fetch_single_match_async(api_key, mid, routing=routing)
            )
            if match_data is None:
                command.stdout.write(f"    {mid} - fetch failed, skipping")
                had_fetch_fail = True
                continue

            result = filter_match(match_data, puuid_to_player)

            if not result.get("store"):
                if result.get("stop"):
                    break
                continue

            game_version = result["game_version"]
            game_start_utc = result["game_start_utc"]

            try:
                if process_match(
                    match_data,
                    puuid_to_player,
                    game_version=game_version,
                    server=server,
                ):
                    total_stored += 1
                    command.stdout.write(
                        f"    {mid} - stored ({game_start_utc.date()}, {game_version})"
                    )
                else:
                    command.stdout.write(f"    {mid} - already existed")
            except Exception as exc:
                logger.error("Error processing %s: %s", mid, exc, exc_info=True)

        player.last_polled_at = now_utc
        if not had_fetch_fail:
            player.last_seen_match_id = match_ids[0]
            player.save(update_fields=["last_seen_match_id", "last_polled_at"])
        else:
            player.save(update_fields=["last_polled_at"])

    return total_stored


def finish_fetch(command, total_stored: int, server: str) -> None:
    """Print summary and recompute stats if new matches were stored."""
    command.stdout.write(f"\nStored {total_stored} new match(es) in total.")

    if total_stored:
        command.stdout.write(f"Recomputing {server} unit statistics...")
        count = recompute_unit_stats(server=server)
        command.stdout.write(
            command.style.SUCCESS(f"Done - updated stats for {count} unit(s).")
        )
    else:
        command.stdout.write(command.style.SUCCESS("Nothing new - stats unchanged."))
