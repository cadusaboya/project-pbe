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
from pathlib import Path

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand

LAST_RUN_FILE = Path(settings.BASE_DIR) / ".last_fetch_pbe"

from tracker.models import Match, Player
from tracker.services.aggregation import recompute_unit_stats
from tracker.services.match_processor import process_match
from tracker.services.riot_api import RiotAPIService

logger = logging.getLogger(__name__)

GAME_VERSION = "16.6 PBE Alpha - No Items THex"

# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = (
        "Fetch the last 20 TFT matches per tracked player from the Riot PBE API, "
        "store new matches, and recompute unit statistics."
    )

    # ------------------------------------------------------------------
    # Entry point — fully synchronous; asyncio.run() is used only for
    # the pure HTTP phases so Django ORM is never called from async code.
    # ------------------------------------------------------------------

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
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(
                self.style.ERROR("RIOT_API_KEY is not set. Add it to your .env file.")
            )
            return

        all_players = list(Player.objects.filter(puuid__isnull=False).exclude(puuid=""))
        if not all_players:
            self.stderr.write(
                self.style.ERROR("No players in DB. Run 'python manage.py fetch_puuid' first.")
            )
            return

        puuid_to_player: dict[str, Player] = {p.puuid: p for p in all_players}

        # ------------------------------------------------------------------
        # --match: fetch and store a single specific match, skip all filters
        # ------------------------------------------------------------------
        match_id = options.get("match")
        if match_id:
            self._handle_single_match(api_key, match_id, puuid_to_player)
            return

        # ------------------------------------------------------------------
        # Normal flow: iterate players
        # ------------------------------------------------------------------
        player_filter = options.get("player")
        if player_filter:
            players = [p for p in all_players if p.game_name.lower() == player_filter.lower()]
            if not players:
                self.stderr.write(self.style.ERROR(f"No player found matching '{player_filter}'."))
                return
        else:
            players = all_players

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        today_utc = now_utc.date()
        yesterday_utc = today_utc - datetime.timedelta(days=1)
        # Riot TFT match API startTime accepts epoch in MILLISECONDS.
        # Use a 2-day window so matches played near midnight UTC aren't missed.
        fetch_since_ms = int(
            datetime.datetime(
                yesterday_utc.year, yesterday_utc.month, yesterday_utc.day,
                tzinfo=datetime.timezone.utc
            ).timestamp() * 1000
        )

        self.stdout.write(
            f"Processing {len(players)} players — matches on/after "
            f"{yesterday_utc.isoformat()} UTC\n"
        )

        total_stored = 0

        for i, player in enumerate(players, 1):
            label = f"[{i}/{len(players)}] {player}"

            # 1. Fetch this player's match IDs for today (single request)
            match_ids = asyncio.run(
                self._fetch_match_ids_for_player(api_key, player.puuid, fetch_since_ms)
            )

            if not match_ids:
                self.stdout.write(f"  {label} — no matches today, skipping")
                continue

            # 2. Filter: already in DB
            existing: set[str] = set(
                Match.objects.filter(match_id__in=match_ids).values_list("match_id", flat=True)
            )
            new_ids = [mid for mid in match_ids if mid not in existing]

            if not new_ids:
                self.stdout.write(f"  {label} — {len(match_ids)} match(es), all already stored")
                continue

            self.stdout.write(
                f"  {label} — {len(match_ids)} match(es), {len(new_ids)} to check"
            )

            # 3. Fetch each candidate match, verify date, save immediately
            for mid in new_ids:
                match_data = asyncio.run(self._fetch_single_match_async(api_key, mid))
                if match_data is None:
                    self.stdout.write(f"    {mid} — fetch failed, skipping")
                    continue

                # Hard date guard: discard anything before today UTC.
                game_ms = match_data.get("info", {}).get("game_datetime", 0)
                game_date = datetime.datetime.fromtimestamp(
                    game_ms / 1000, tz=datetime.timezone.utc
                ).date()
                if game_date < yesterday_utc:
                    self.stdout.write(f"    {mid} — old ({game_date}), stopping")
                    break

                # Only store matches where at least 4 participants are tracked players.
                participant_puuids = {
                    p.get("puuid") for p in match_data.get("info", {}).get("participants", [])
                }
                tracked_count = sum(1 for p in participant_puuids if p in puuid_to_player)
                if tracked_count < 4:
                    self.stdout.write(f"    {mid} — skipped ({tracked_count}/8 tracked)")
                    continue

                try:
                    if process_match(match_data, puuid_to_player, game_version=GAME_VERSION):
                        total_stored += 1
                        self.stdout.write(f"    {mid} — stored ({game_date})")
                    else:
                        self.stdout.write(f"    {mid} — already existed")
                except Exception as exc:
                    logger.error("Error processing %s: %s", mid, exc, exc_info=True)

        self.stdout.write(f"\nStored {total_stored} new match(es) in total.")

        # Recompute stats only if something new was stored
        if total_stored:
            self.stdout.write("Recomputing unit statistics…")
            count = recompute_unit_stats()
            self.stdout.write(self.style.SUCCESS(f"Done — updated stats for {count} unit(s)."))
        else:
            self.stdout.write(self.style.SUCCESS("Nothing new — stats unchanged."))

        LAST_RUN_FILE.write_text(datetime.datetime.now(datetime.timezone.utc).isoformat())

    def _handle_single_match(self, api_key, match_id, puuid_to_player):
        self.stdout.write(f"Fetching specific match: {match_id}")
        match_data = asyncio.run(self._fetch_single_match_async(api_key, match_id))
        if match_data is None:
            self.stderr.write(self.style.ERROR(f"{match_id} — fetch failed"))
            return
        try:
            if process_match(match_data, puuid_to_player, game_version=GAME_VERSION):
                self.stdout.write(self.style.SUCCESS(f"{match_id} — stored"))
                count = recompute_unit_stats()
                self.stdout.write(self.style.SUCCESS(f"Done — updated stats for {count} unit(s)."))
            else:
                self.stdout.write(f"{match_id} — already existed")
        except Exception as exc:
            logger.error("Error processing %s: %s", match_id, exc, exc_info=True)
            self.stderr.write(self.style.ERROR(str(exc)))

    # ------------------------------------------------------------------
    # Pure async HTTP helpers — NO ORM calls allowed here
    # ------------------------------------------------------------------

    async def _fetch_match_ids_for_player(
        self,
        api_key: str,
        puuid: str,
        start_time: int,
    ) -> list[str]:
        service = RiotAPIService(api_key)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            return await service.get_match_ids(client, puuid, count=20, start_time=start_time)

    async def _fetch_single_match_async(
        self,
        api_key: str,
        match_id: str,
    ):
        service = RiotAPIService(api_key)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            return await service.get_match(client, match_id)
