"""Shared utilities for player list parsing and PUUID resolution."""
import asyncio
import logging

import httpx

from tracker.services.riot_api import RATE_LIMITED, RiotAPIService

logger = logging.getLogger(__name__)

STRIP_CHARS = "\u2066\u2069\u200b\u200c\u200d\ufeff"


def strip_unicode(text: str) -> str:
    """Remove invisible Unicode directional/zero-width characters."""
    for ch in STRIP_CHARS:
        text = text.replace(ch, "")
    return text.strip()


def parse_player_lines(
    raw_list: str,
    default_tag: str = "pbe",
    parse_region: bool = False,
    default_region: str = "NA1",
):
    """
    Parse a multi-line player list string into a list of tuples.

    Each line format:
      - PBE:  "GameName#TagLine" or just "GameName" (default_tag used)
      - LIVE: "GameName#TagLine:REGION" (default_tag and region defaults)

    Returns list of (game_name, tag_line) or (game_name, tag_line, region) tuples.
    Deduplicates case-insensitively while preserving order.
    """
    seen = set()
    result = []

    for raw_line in raw_list.strip().splitlines():
        line = strip_unicode(raw_line).strip()
        if not line:
            continue

        region = None
        if parse_region:
            # Lines starting with '#' could be comments; skip them.
            if line.startswith("#"):
                continue
            # Split off :REGION suffix
            if ":" in line:
                base, region = line.rsplit(":", 1)
                region = region.strip().upper()
                line = base.strip()
            else:
                region = default_region

        if "#" in line:
            game_name, tag_line = line.split("#", 1)
            game_name = game_name.strip()
            tag_line = tag_line.strip()
        else:
            game_name = line
            tag_line = default_tag

        if not game_name:
            continue

        if parse_region:
            key = (game_name.lower(), tag_line.lower(), region)
        else:
            key = (game_name.lower(), tag_line.lower())
        if key in seen:
            continue
        seen.add(key)

        if parse_region:
            result.append((game_name, tag_line, region))
        else:
            result.append((game_name, tag_line))

    return result


async def fetch_accounts_async(
    api_key: str,
    need_fetch: list,
    routing: str = "americas",
    batch_size: int = 5,
    rate_limit_wait: int = 120,
    stdout=None,
) -> list:
    """
    Batch-resolve account PUUIDs via Riot Account API.

    Processes in small batches. When a batch has failures (possible rate limit),
    waits ``rate_limit_wait`` seconds and retries the failed ones once.

    Args:
        api_key: Riot API key
        need_fetch: list of (game_name, tag_line, ...) tuples
        routing: Riot routing value (americas, europe, asia, sea)
        batch_size: how many concurrent requests per batch
        rate_limit_wait: seconds to wait when rate limited
        stdout: optional management command stdout for progress logging

    Returns: list of account dicts (or None for failures), same order as input
    """
    service = RiotAPIService(api_key, routing=routing)
    results: list = [None] * len(need_fetch)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), follow_redirects=True
    ) as client:
        for batch_start in range(0, len(need_fetch), batch_size):
            batch_end = min(batch_start + batch_size, len(need_fetch))
            batch = need_fetch[batch_start:batch_end]

            tasks = [service.get_account(client, p[0], p[1]) for p in batch]
            batch_results = await asyncio.gather(*tasks)

            # Separate rate-limited from real failures
            rate_limited_indices = []
            for i, res in enumerate(batch_results):
                idx = batch_start + i
                if res is RATE_LIMITED:
                    rate_limited_indices.append((i, idx))
                elif res is not None:
                    results[idx] = res
                # res is None → hard failure (404 etc.), skip

            # Only wait + retry for rate-limited requests
            if rate_limited_indices:
                msg = f"  Rate limited on {len(rate_limited_indices)} requests in batch {batch_start+1}-{batch_end}, waiting {rate_limit_wait}s..."
                if stdout:
                    stdout.write(msg)
                else:
                    logger.warning(msg)
                await asyncio.sleep(rate_limit_wait)

                retry_tasks = [
                    service.get_account(client, batch[i][0], batch[i][1])
                    for i, _ in rate_limited_indices
                ]
                retry_results = await asyncio.gather(*retry_tasks)
                for (_, idx), res in zip(rate_limited_indices, retry_results):
                    if res is not None and res is not RATE_LIMITED:
                        results[idx] = res

            if stdout and batch_end % 50 < batch_size:
                stdout.write(f"  Resolved {batch_end}/{len(need_fetch)}...")

    return results
