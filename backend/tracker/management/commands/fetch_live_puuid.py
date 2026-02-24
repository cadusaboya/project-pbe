"""
Management command: fetch_live_puuid

Resolves Live server pro players to PUUIDs via the Riot Account API
and persists them in the Player table with the correct region.

Format: GameName#TagLine:REGION
  e.g.  Faker#KR1:KR
        Broken Blade#EUW:EUW1

Run once, or whenever the player list changes:
    python manage.py fetch_live_puuid
"""
import asyncio
import logging
import os

import httpx
from django.core.management.base import BaseCommand

from tracker.models import Player
from tracker.services.riot_api import RiotAPIService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hardcoded Live player list
# Format: GameName#TagLine:REGION
# ---------------------------------------------------------------------------

_RAW_PLAYER_LIST = """\
"""

_STRIP_CHARS = "\u2066\u2069\u200b\u200c\u200d\ufeff"


def _parse_player(raw: str) -> tuple[str, str, str]:
    """Parse 'GameName#TagLine:REGION' → (game_name, tag_line, region)."""
    cleaned = raw.strip()
    for ch in _STRIP_CHARS:
        cleaned = cleaned.replace(ch, "")
    cleaned = cleaned.strip()

    region = "NA1"  # default region
    if ":" in cleaned:
        cleaned, region = cleaned.rsplit(":", 1)
        region = region.strip().upper()

    if "#" in cleaned:
        game_name, tag_line = cleaned.split("#", 1)
        return game_name.strip(), tag_line.strip(), region
    return cleaned, "NA1", region


def build_player_list() -> list[tuple[str, str, str]]:
    """Parse raw list, strip blank lines, and deduplicate (case-insensitive)."""
    seen: set[tuple[str, str, str]] = set()
    result: list[tuple[str, str, str]] = []
    for line in _RAW_PLAYER_LIST.splitlines():
        line = line.strip()
        if not line:
            continue
        game_name, tag_line, region = _parse_player(line)
        if not game_name:
            continue
        key = (game_name.lower(), tag_line.lower(), region)
        if key in seen:
            continue
        seen.add(key)
        result.append((game_name, tag_line, region))
    return result


class Command(BaseCommand):
    help = "Resolve Live pro Riot IDs → PUUIDs and store them in the Player table."

    def handle(self, *args, **options):
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(self.style.ERROR("RIOT_API_KEY is not set."))
            return

        player_list = build_player_list()
        self.stdout.write(f"Live player list: {len(player_list)} unique entries.")

        if not player_list:
            self.stdout.write(self.style.WARNING("Player list is empty — add players to _RAW_PLAYER_LIST."))
            return

        existing: set[tuple[str, str, str]] = {
            (p.game_name.lower(), p.tag_line.lower(), p.region)
            for p in Player.objects.filter(puuid__isnull=False).exclude(puuid="").exclude(region="PBE")
        }
        need_fetch = [
            (gn, tl, reg)
            for gn, tl, reg in player_list
            if (gn.lower(), tl.lower(), reg) not in existing
        ]

        if not need_fetch:
            self.stdout.write(self.style.SUCCESS("All PUUIDs already resolved — nothing to do."))
            return

        self.stdout.write(
            f"  {len(existing)} already in DB, fetching {len(need_fetch)} from API…"
        )

        accounts = asyncio.run(self._fetch_accounts_async(api_key, need_fetch))

        saved = skipped = 0
        for (game_name, tag_line, region), data in zip(need_fetch, accounts):
            if data is None:
                logger.warning("Could not resolve '%s#%s' (%s) — skipping.", game_name, tag_line, region)
                skipped += 1
                continue
            puuid: str = data.get("puuid", "")
            if not puuid:
                skipped += 1
                continue
            Player.objects.update_or_create(
                game_name=game_name,
                tag_line=tag_line,
                region=region,
                defaults={"puuid": puuid},
            )
            saved += 1

        self.stdout.write(
            self.style.SUCCESS(f"Done — {saved} saved, {skipped} could not be resolved.")
        )

    async def _fetch_accounts_async(
        self,
        api_key: str,
        need_fetch: list[tuple[str, str, str]],
    ) -> list:
        # Account API always uses americas routing
        service = RiotAPIService(api_key, routing="americas")
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            tasks = [service.get_account(client, gn, tl) for gn, tl, _ in need_fetch]
            return await asyncio.gather(*tasks)
