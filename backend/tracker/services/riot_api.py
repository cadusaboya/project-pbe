"""
Async Riot API client.

Features:
  - Concurrency limited to CONCURRENCY_LIMIT simultaneous in-flight requests
    (semaphore released during sleep so other slots can proceed).
  - Exponential back-off on 429 responses, using Retry-After header when present.
  - Returns None on 404 or unrecoverable errors; callers must handle None.
"""
import asyncio
import logging
from typing import Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

CONCURRENCY_LIMIT = 5
MAX_RETRIES = 6
BASE_BACKOFF = 1.0  # seconds; doubles each retry

REGION_ROUTING = {
    "americas": "https://americas.api.riotgames.com",
    "europe": "https://europe.api.riotgames.com",
    "asia": "https://asia.api.riotgames.com",
    "sea": "https://sea.api.riotgames.com",
}

PLATFORM_TO_ROUTING = {
    "PBE": "americas",
    "NA1": "americas",
    "NA": "americas",
    "BR1": "americas",
    "LA1": "americas",
    "LA2": "americas",
    "LAS": "americas",
    "EUW1": "europe",
    "EUW": "europe",
    "EUNE1": "europe",
    "EUNE": "europe",
    "TR1": "europe",
    "RU": "europe",
    "KR": "asia",
    "JP1": "asia",
    "OC1": "sea",
    "PH2": "sea",
    "SG2": "sea",
    "TH2": "sea",
    "TW2": "sea",
    "VN2": "sea",
}


def platform_to_server(platform: str) -> str:
    """Map a platform/region code to the user-facing server name."""
    return "PBE" if platform == "PBE" else "LIVE"


class RiotAPIError(Exception):
    pass


class RiotAPIService:
    BASE_URL = "https://americas.api.riotgames.com"

    def __init__(self, api_key: str, routing: str = "americas") -> None:
        if not api_key:
            raise RiotAPIError("api_key must not be empty")
        self.api_key = api_key
        self.base_url = REGION_ROUTING.get(routing, REGION_ROUTING["americas"])
        # Semaphore is lazily bound to the running event loop (Python 3.10+).
        self._semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

    @classmethod
    def for_platform(cls, api_key: str, platform: str) -> "RiotAPIService":
        """Create an instance routed to the correct region for the given platform."""
        routing = PLATFORM_TO_ROUTING.get(platform, "americas")
        return cls(api_key, routing=routing)

    # ------------------------------------------------------------------
    # Internal request helper
    # ------------------------------------------------------------------

    async def _request(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: dict | None = None,
    ) -> Optional[dict | list]:
        headers = {"X-Riot-Token": self.api_key}

        for attempt in range(MAX_RETRIES):
            response: httpx.Response | None = None

            # Acquire semaphore only for the actual HTTP call, not the sleep.
            async with self._semaphore:
                try:
                    response = await client.get(url, headers=headers, params=params)
                except httpx.RequestError as exc:
                    logger.error("Network error fetching %s: %s", url, exc)
                    response = None

            # ---- process response outside the semaphore --------------------

            if response is None:
                if attempt < MAX_RETRIES - 1:
                    wait = BASE_BACKOFF * (2 ** attempt)
                    logger.warning("Retrying %s in %.1fs (attempt %d)", url, wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                logger.error("Exhausted retries for %s (network errors)", url)
                return None

            if response.status_code == 200:
                return response.json()

            if response.status_code == 429:
                retry_after = float(
                    response.headers.get("Retry-After", BASE_BACKOFF * (2 ** attempt))
                )
                logger.warning(
                    "Rate-limited on %s — waiting %.1fs (attempt %d/%d)",
                    url,
                    retry_after,
                    attempt + 1,
                    MAX_RETRIES,
                )
                await asyncio.sleep(retry_after)
                continue

            if response.status_code == 404:
                logger.warning("Not found: %s", url)
                return None

            # Any other non-200 status
            logger.error("HTTP %s for %s", response.status_code, url)
            if attempt < MAX_RETRIES - 1:
                wait = BASE_BACKOFF * (2 ** attempt)
                await asyncio.sleep(wait)
                continue
            return None

        logger.error("Exhausted retries for %s", url)
        return None

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def get_account(
        self,
        client: httpx.AsyncClient,
        game_name: str,
        tag_line: str,
    ) -> Optional[dict]:
        """
        GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
        Returns: {"puuid": "...", "gameName": "...", "tagLine": "..."}
        """
        url = (
            f"{self.base_url}/riot/account/v1/accounts/by-riot-id"
            f"/{quote(game_name, safe='')}/{quote(tag_line, safe='')}"
        )
        return await self._request(client, url)

    async def get_match_ids(
        self,
        client: httpx.AsyncClient,
        puuid: str,
        count: int = 20,
        start_time: int | None = None,
    ) -> list[str]:
        """
        GET /tft/match/v1/matches/by-puuid/{puuid}/ids
        Returns list of match ID strings (may be empty).

        start_time: optional Unix timestamp (seconds) — only matches after this
                    point are returned.
        """
        url = f"{self.base_url}/tft/match/v1/matches/by-puuid/{puuid}/ids"
        params: dict = {"count": count}
        if start_time is not None:
            params["startTime"] = start_time
        result = await self._request(client, url, params=params)
        if isinstance(result, list):
            return result
        return []

    async def get_match(
        self,
        client: httpx.AsyncClient,
        match_id: str,
    ) -> Optional[dict]:
        """
        GET /tft/match/v1/matches/{matchId}
        Returns full match JSON or None.
        """
        url = f"{self.base_url}/tft/match/v1/matches/{match_id}"
        return await self._request(client, url)
