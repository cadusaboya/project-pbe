"""
Management command: fetch_pbe

Prereq: run 'python manage.py fetch_puuid' once to populate the Player table.

Steps:
  1. Load all players with a stored PUUID from the DB.
  2. Fetch the last 20 match IDs per player (async), deduplicate.
  3. Filter out match IDs already in the database.
  4. Fetch full match JSON for new matches (async).
  5. Store matches, participants, and unit usages.
  6. Recompute AggregatedUnitStat for every unit.

Usage:
    python manage.py fetch_pbe
    python manage.py fetch_pbe --player DarthNub
    python manage.py fetch_pbe --match PBE1_4525031743
"""

import asyncio
import datetime
import logging
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.management.base import BaseCommand

from tracker.models import Player
from tracker.services.aggregation import recompute_unit_stats
from tracker.services.match_processor import process_match
from tracker.management.commands._fetch_utils import (
    fetch_single_match_async,
    finish_fetch,
    process_player_matches,
)

logger = logging.getLogger(__name__)

GAME_VERSION = "Set 17 A"
DEFAULT_FETCH_CUTOFF_DATE = "2026-02-23"
DEFAULT_FETCH_CUTOFF_TIME = "00:00"
DEFAULT_FETCH_CUTOFF_TZ = "America/Cuiaba"

MIN_TRACKED_PLAYERS = 1


class Command(BaseCommand):
    help = (
        "Fetch the last 20 TFT matches per tracked player from the Riot PBE API, "
        "store new matches, and recompute unit statistics."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--player",
            type=str,
            default=None,
            help="Game name to filter (case-insensitive). E.g.: --player DarthNub",
        )
        parser.add_argument(
            "--match",
            type=str,
            default=None,
            help="Fetch and store a specific match ID directly. E.g.: --match PBE1_4525031743",
        )

    def handle(self, *args, **options):
        fetch_cutoff_utc = self._build_fetch_cutoff_datetime_utc()
        cooldown_seconds = self._get_player_cooldown_seconds()
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(
                self.style.ERROR("RIOT_API_KEY is not set. Add it to your .env file.")
            )
            return

        all_players = list(Player.objects.filter(puuid__isnull=False, region="PBE").exclude(puuid=""))
        if not all_players:
            self.stderr.write(
                self.style.ERROR("No players in DB. Run 'python manage.py fetch_puuid' first.")
            )
            return

        puuid_to_player: dict[str, Player] = {p.puuid: p for p in all_players}

        match_id = options.get("match")
        if match_id:
            self._handle_single_match(
                api_key,
                match_id,
                puuid_to_player,
                fetch_cutoff_utc,
            )
            return

        player_filter = options.get("player")
        if player_filter:
            players = [p for p in all_players if p.game_name.lower() == player_filter.lower()]
            if not players:
                self.stderr.write(self.style.ERROR(f"No player found matching '{player_filter}'."))
                return
        else:
            players = all_players

        fetch_since = int(fetch_cutoff_utc.timestamp())

        self.stdout.write(
            f"Processing {len(players)} players - matches on/after {fetch_cutoff_utc.isoformat()} UTC\n"
        )
        if cooldown_seconds > 0:
            self.stdout.write(f"Per-player poll cooldown: {cooldown_seconds}s\n")
        self.stdout.write(f"Game version: {GAME_VERSION}\n")

        def _filter_match(match_data, puuid_map):
            """PBE match filter: date cutoff + min tracked players."""
            game_ms = match_data.get("info", {}).get("game_datetime", 0)
            game_start_utc = datetime.datetime.fromtimestamp(
                game_ms / 1000, tz=datetime.timezone.utc
            )
            if game_start_utc < fetch_cutoff_utc:
                mid = match_data.get("metadata", {}).get("match_id", "?")
                self.stdout.write(f"    {mid} - old ({game_start_utc.isoformat()}), stopping")
                return {"store": False, "stop": True}

            participant_puuids = {
                p.get("puuid") for p in match_data.get("info", {}).get("participants", [])
            }
            tracked_count = sum(1 for p in participant_puuids if p in puuid_map)
            if tracked_count < MIN_TRACKED_PLAYERS:
                mid = match_data.get("metadata", {}).get("match_id", "?")
                self.stdout.write(f"    {mid} - skipped ({tracked_count}/8 tracked)")
                return {"store": False, "stop": False}

            return {
                "store": True,
                "game_version": GAME_VERSION,
                "game_start_utc": game_start_utc,
            }

        total_stored = process_player_matches(
            command=self,
            api_key=api_key,
            players=players,
            puuid_to_player=puuid_to_player,
            server="PBE",
            get_routing=lambda _player: "americas",
            get_match_ids_kwargs=lambda _player: {"start_time": fetch_since},
            filter_match=_filter_match,
            cooldown_seconds=cooldown_seconds,
        )

        finish_fetch(self, total_stored, server="PBE")

    def _handle_single_match(
        self,
        api_key,
        match_id,
        puuid_to_player,
        fetch_cutoff_utc: datetime.datetime,
    ):
        self.stdout.write(f"Fetching specific match: {match_id}")
        match_data = asyncio.run(fetch_single_match_async(api_key, match_id))
        if match_data is None:
            self.stderr.write(self.style.ERROR(f"{match_id} - fetch failed"))
            return
        game_ms = match_data.get("info", {}).get("game_datetime", 0)
        game_start_utc = datetime.datetime.fromtimestamp(
            game_ms / 1000, tz=datetime.timezone.utc
        )
        if game_start_utc < fetch_cutoff_utc:
            self.stderr.write(
                self.style.ERROR(
                    f"{match_id} - old ({game_start_utc.isoformat()}), cutoff is "
                    f"{fetch_cutoff_utc.isoformat()} UTC"
                )
            )
            return
        try:
            if process_match(match_data, puuid_to_player, game_version=GAME_VERSION, server="PBE"):
                self.stdout.write(self.style.SUCCESS(f"{match_id} - stored"))
                count = recompute_unit_stats(server="PBE")
                self.stdout.write(self.style.SUCCESS(f"Done - updated stats for {count} unit(s)."))
            else:
                self.stdout.write(f"{match_id} - already existed")
        except Exception as exc:
            logger.error("Error processing %s: %s", match_id, exc, exc_info=True)
            self.stderr.write(self.style.ERROR(str(exc)))

    def _build_fetch_cutoff_datetime_utc(self) -> datetime.datetime:
        cutoff_date = os.environ.get("PBE_QUEUE_CUTOFF_DATE", DEFAULT_FETCH_CUTOFF_DATE).strip()
        cutoff_time = os.environ.get("PBE_QUEUE_CUTOFF_TIME", DEFAULT_FETCH_CUTOFF_TIME).strip()
        tz_name = os.environ.get("PBE_QUEUE_CUTOFF_TZ", DEFAULT_FETCH_CUTOFF_TZ).strip()

        try:
            tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            logger.warning("Invalid timezone '%s'. Falling back to UTC.", tz_name)
            tz = datetime.timezone.utc

        naive_cutoff = datetime.datetime.strptime(
            f"{cutoff_date} {cutoff_time}", "%Y-%m-%d %H:%M"
        )
        local_cutoff = naive_cutoff.replace(tzinfo=tz)
        return local_cutoff.astimezone(datetime.timezone.utc)

    def _get_player_cooldown_seconds(self) -> int:
        raw = os.environ.get("FETCH_PBE_PLAYER_COOLDOWN_SECONDS", "0").strip()
        try:
            return max(0, int(raw))
        except ValueError:
            return 0
