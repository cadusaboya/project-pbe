"""
Management command: fetch_live

Fetches recent TFT matches for all tracked Live-server pro players.

Prereq: run 'python manage.py fetch_live_puuid' once to populate the Player table.

Steps:
  1. Load all Live players (region != PBE) with a stored PUUID from the DB.
  2. Group by region, create RiotAPIService per routing.
  3. Fetch the last 20 match IDs per player (async), deduplicate.
  4. Filter out match IDs already in the database.
  5. Fetch full match JSON for new matches (async).
  6. Store matches, participants, and unit usages (server="LIVE").
  7. Recompute AggregatedUnitStat for LIVE server.

Usage:
    python manage.py fetch_live
    python manage.py fetch_live --player Faker
    python manage.py fetch_live --region KR
    python manage.py fetch_live --match NA1_1234567
"""

import asyncio
import datetime
import logging
import os
import re

from django.core.management.base import BaseCommand

from tracker.constants import CURRENT_SET_NUMBER
from tracker.models import Player
from tracker.services.aggregation import recompute_unit_stats
from tracker.services.match_processor import process_match
from tracker.services.riot_api import PLATFORM_TO_ROUTING
from tracker.management.commands._fetch_utils import (
    fetch_single_match_async,
    finish_fetch,
    process_player_matches,
)

logger = logging.getLogger(__name__)

FALLBACK_GAME_VERSION = os.environ.get("LIVE_GAME_VERSION", "16.6")

# Minimum tracked players in a lobby to store the match.
# 1 = save any game with at least 1 tracked pro.
MIN_TRACKED_PLAYERS = 1

# Only store matches from this patch onward (inclusive).
MIN_GAME_VERSION = os.environ.get("LIVE_MIN_GAME_VERSION", "16.5")

_VERSION_RE = re.compile(r"Version (\d+\.\d+)")


def _version_tuple(v: str) -> tuple[int, int]:
    """Parse '16.5' -> (16, 5) for comparison."""
    parts = v.split(".")
    return int(parts[0]), int(parts[1]) if len(parts) > 1 else 0


def _extract_game_version(match_data: dict) -> str:
    """Extract patch version from raw Riot game_version string.

    Live servers report the *build* version which is one minor behind the
    actual patch.  e.g. '16.4.748.0682' is patch 16.5, so we add 1 to the
    minor component.
    """
    raw = match_data.get("info", {}).get("game_version", "")
    m = _VERSION_RE.search(raw)
    if not m:
        return FALLBACK_GAME_VERSION
    major, minor = m.group(1).split(".")
    return f"{major}.{int(minor) + 1}"


class Command(BaseCommand):
    help = (
        "Fetch recent TFT matches for tracked Live-server pro players, "
        "store new matches, and recompute unit statistics."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--player",
            type=str,
            default=None,
            help="Game name to filter (case-insensitive). E.g.: --player Faker",
        )
        parser.add_argument(
            "--region",
            type=str,
            default=None,
            help="Region to filter (e.g. KR, NA1, EUW1). Only fetch players from this region.",
        )
        parser.add_argument(
            "--match",
            type=str,
            default=None,
            help="Fetch and store a specific match ID directly. E.g.: --match NA1_1234567",
        )

    def handle(self, *args, **options):
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(
                self.style.ERROR("RIOT_API_KEY is not set. Add it to your .env file.")
            )
            return

        all_players = list(
            Player.objects.filter(puuid__isnull=False)
            .exclude(puuid="")
            .exclude(region="PBE")
        )
        if not all_players:
            self.stderr.write(
                self.style.ERROR("No Live players in DB. Run 'python manage.py fetch_live_puuid' first.")
            )
            return

        region_filter = options.get("region")
        if region_filter:
            region_filter = region_filter.upper()
            all_players = [p for p in all_players if p.region == region_filter]
            if not all_players:
                self.stderr.write(self.style.ERROR(f"No players found for region '{region_filter}'."))
                return

        puuid_to_player: dict[str, Player] = {p.puuid: p for p in all_players}

        match_id = options.get("match")
        if match_id:
            self._handle_single_match(api_key, match_id, puuid_to_player)
            return

        player_filter = options.get("player")
        if player_filter:
            players = [p for p in all_players if p.game_name.lower() == player_filter.lower()]
            if not players:
                self.stderr.write(self.style.ERROR(f"No player found matching '{player_filter}'."))
                return
        else:
            players = all_players

        self.stdout.write(f"Processing {len(players)} Live players\n")

        def _filter_match(match_data, puuid_map):
            """LIVE match filter: Double Up, set core, tracked count, version."""
            mid = match_data.get("metadata", {}).get("match_id", "?")

            # Skip Double Up games (pairs mode)
            game_type = match_data.get("info", {}).get("tft_game_type", "")
            if game_type == "pairs":
                self.stdout.write(f"    {mid} - Double Up, skipping")
                return {"store": False, "stop": False}

            # Skip Revival / non-Set16 games
            set_core = match_data.get("info", {}).get("tft_set_core_name", "")
            if not set_core.startswith(f"TFTSet{CURRENT_SET_NUMBER}"):
                self.stdout.write(f"    {mid} - {set_core or 'unknown set'}, skipping")
                return {"store": False, "stop": False}

            game_ms = match_data.get("info", {}).get("game_datetime", 0)
            game_start_utc = datetime.datetime.fromtimestamp(
                game_ms / 1000, tz=datetime.timezone.utc
            )

            participant_puuids = {
                p.get("puuid") for p in match_data.get("info", {}).get("participants", [])
            }
            tracked_count = sum(1 for p in participant_puuids if p in puuid_map)
            if tracked_count < MIN_TRACKED_PLAYERS:
                self.stdout.write(f"    {mid} - skipped ({tracked_count}/8 tracked)")
                return {"store": False, "stop": False}

            version = _extract_game_version(match_data)
            if _version_tuple(version) < _version_tuple(MIN_GAME_VERSION):
                self.stdout.write(f"    {mid} - old patch {version}, skipping")
                return {"store": False, "stop": False}

            return {
                "store": True,
                "game_version": version,
                "game_start_utc": game_start_utc,
            }

        total_stored = process_player_matches(
            command=self,
            api_key=api_key,
            players=players,
            puuid_to_player=puuid_to_player,
            server="LIVE",
            get_routing=lambda player: PLATFORM_TO_ROUTING.get(player.region, "americas"),
            get_match_ids_kwargs=lambda _player: {},
            filter_match=_filter_match,
        )

        finish_fetch(self, total_stored, server="LIVE")

    def _handle_single_match(self, api_key, match_id, puuid_to_player):
        self.stdout.write(f"Fetching specific match: {match_id}")
        # Infer routing from match ID prefix (e.g., NA1_, EUW1_, KR_)
        prefix = match_id.split("_")[0] if "_" in match_id else "NA1"
        routing = PLATFORM_TO_ROUTING.get(prefix, "americas")

        match_data = asyncio.run(fetch_single_match_async(api_key, match_id, routing))
        if match_data is None:
            self.stderr.write(self.style.ERROR(f"{match_id} - fetch failed"))
            return
        game_type = match_data.get("info", {}).get("tft_game_type", "")
        if game_type == "pairs":
            self.stdout.write(self.style.WARNING(f"{match_id} - Double Up, skipping"))
            return
        set_core = match_data.get("info", {}).get("tft_set_core_name", "")
        if not set_core.startswith(f"TFTSet{CURRENT_SET_NUMBER}"):
            self.stdout.write(self.style.WARNING(f"{match_id} - {set_core or 'unknown set'}, skipping"))
            return

        version = _extract_game_version(match_data)
        if _version_tuple(version) < _version_tuple(MIN_GAME_VERSION):
            self.stdout.write(self.style.WARNING(f"{match_id} - old patch {version}, skipping"))
            return

        try:
            if process_match(match_data, puuid_to_player, game_version=version, server="LIVE"):
                self.stdout.write(self.style.SUCCESS(f"{match_id} - stored ({version})"))

                count = recompute_unit_stats(server="LIVE")
                self.stdout.write(self.style.SUCCESS(f"Done - updated stats for {count} unit(s)."))
            else:
                self.stdout.write(f"{match_id} - already existed")
        except Exception as exc:
            logger.error("Error processing %s: %s", match_id, exc, exc_info=True)
            self.stderr.write(self.style.ERROR(str(exc)))
