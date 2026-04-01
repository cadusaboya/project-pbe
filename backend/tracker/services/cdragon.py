"""
CDragon data fetching and caching for traits and champions.

Provides in-memory + disk caching for trait breakpoints/icons and champion metadata.
Data only changes between TFT sets, so disk cache is the primary source.
"""

import json
from pathlib import Path

import httpx
from django.conf import settings

from tracker.constants import CURRENT_SET_NUMBER, CURRENT_SET_PREFIX

# ── CDragon URLs and config ──────────────────────────────────────────────────

CDRAGON_TFT_URLS = {
    "PBE": "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json",
    "LIVE": "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json",
    "SCRIMS": "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json",
}
CDRAGON_ICON_BASES = {
    "PBE": "https://raw.communitydragon.org/pbe/game/",
    "LIVE": "https://raw.communitydragon.org/latest/game/",
    "SCRIMS": "https://raw.communitydragon.org/pbe/game/",
}
CDRAGON_TIMEOUT = 10  # seconds

# Persistent cache directory for CDragon data
CDRAGON_CACHE_DIR = Path(settings.BASE_DIR) / ".cdragon_cache"
CDRAGON_CACHE_DIR.mkdir(exist_ok=True)

# ── In-memory caches ─────────────────────────────────────────────────────────

# Server-keyed caches: {server: data}
TRAIT_CACHE: dict[str, dict] = {}
TRAIT_API_NAME_MAP: dict[str, dict[str, str]] = {}  # server -> {apiName: displayName}
CHAMPIONS_CACHE: dict[str, list] = {}


# ── Trait helpers ─────────────────────────────────────────────────────────────

def parse_trait_data(data: dict, icon_base: str) -> tuple[dict, dict[str, str]]:
    """Extract traits and api_name map from raw CDragon JSON."""
    traits: dict = {}
    api_map: dict[str, str] = {}
    current_set = data.get("sets", {}).get(str(CURRENT_SET_NUMBER), {})
    for trait in current_set.get("traits", []):
        name = trait.get("name")
        if not name:
            continue
        api_name = trait.get("apiName", "")
        breakpoints = [
            e["minUnits"]
            for e in (trait.get("effects") or [])
            if e.get("minUnits", 0) > 0
        ]
        if not breakpoints:
            continue
        raw_icon = trait.get("icon", "")
        icon = ""
        if raw_icon:
            icon = (
                icon_base
                + raw_icon.replace("ASSETS/", "assets/")
                          .replace(".tex", ".png")
                          .lower()
            )
        traits[name] = {"breakpoints": breakpoints, "icon": icon}
        if api_name:
            api_map[api_name] = name
    return traits, api_map


def _load_trait_cache_from_disk(server: str) -> tuple[dict, dict[str, str]] | None:
    """Load trait data from persistent file cache."""
    cache_file = CDRAGON_CACHE_DIR / f"traits_{server}.json"
    if not cache_file.exists():
        return None
    try:
        raw = json.loads(cache_file.read_text(encoding="utf-8"))
        return raw.get("traits", {}), raw.get("api_map", {})
    except Exception:
        return None


def _save_trait_cache_to_disk(server: str, traits: dict, api_map: dict[str, str]):
    """Persist trait data to file."""
    cache_file = CDRAGON_CACHE_DIR / f"traits_{server}.json"
    cache_file.write_text(
        json.dumps({"traits": traits, "api_map": api_map}),
        encoding="utf-8",
    )


def ensure_trait_cache(server: str = "PBE") -> dict:
    """Populate TRAIT_CACHE and TRAIT_API_NAME_MAP.

    Priority: memory -> disk -> CDragon (last resort).
    Trait/champion data only changes between sets, so disk cache is preferred.
    """
    global TRAIT_CACHE, TRAIT_API_NAME_MAP

    if server in TRAIT_CACHE:
        return TRAIT_CACHE[server]

    # Try disk cache first
    disk = _load_trait_cache_from_disk(server)
    if disk:
        TRAIT_CACHE[server] = disk[0]
        TRAIT_API_NAME_MAP[server] = disk[1]
        return TRAIT_CACHE[server]

    # No disk cache -- fetch from CDragon
    cdragon_url = CDRAGON_TFT_URLS.get(server, CDRAGON_TFT_URLS["PBE"])
    icon_base = CDRAGON_ICON_BASES.get(server, CDRAGON_ICON_BASES["PBE"])
    try:
        with httpx.Client(timeout=CDRAGON_TIMEOUT) as client:
            resp = client.get(cdragon_url)
            resp.raise_for_status()
            data = resp.json()

        traits, api_map = parse_trait_data(data, icon_base)
        TRAIT_CACHE[server] = traits
        TRAIT_API_NAME_MAP[server] = api_map
        _save_trait_cache_to_disk(server, traits, api_map)
    except Exception:
        # Don't cache empty result -- allow retries on next request
        return {}

    return TRAIT_CACHE.get(server, {})


# ── Champions helpers ─────────────────────────────────────────────────────────

def parse_champions_data(data: dict) -> list:
    """Extract champion list from raw CDragon JSON."""
    champions = []
    current_set = data.get("sets", {}).get(str(CURRENT_SET_NUMBER), {})
    for champ in current_set.get("champions", []):
        api_name: str = champ.get("apiName", "")
        if not api_name:
            continue
        name = champ.get("name", api_name.replace(CURRENT_SET_PREFIX, ""))
        if api_name == f"{CURRENT_SET_PREFIX}AnnieTibbers":
            name = "Annie (Tibbers)"
        champions.append({
            "apiName": api_name,
            "name": name,
            "cost": champ.get("cost", 0),
            "traits": champ.get("traits", []),
        })
    champions.sort(key=lambda c: (c["cost"], c["name"]))
    return champions


def _load_champions_cache_from_disk(server: str) -> list | None:
    """Load champions data from persistent file cache."""
    cache_file = CDRAGON_CACHE_DIR / f"champions_{server}.json"
    if not cache_file.exists():
        return None
    try:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_champions_cache_to_disk(server: str, champions: list):
    """Persist champions data to file."""
    cache_file = CDRAGON_CACHE_DIR / f"champions_{server}.json"
    cache_file.write_text(json.dumps(champions), encoding="utf-8")


def ensure_champions_cache(server: str = "PBE") -> list:
    """Return cached champion list for *server*, fetching from CDragon if needed."""
    global CHAMPIONS_CACHE

    if server in CHAMPIONS_CACHE:
        return CHAMPIONS_CACHE[server]

    # Try disk cache first
    disk = _load_champions_cache_from_disk(server)
    if disk is not None:
        CHAMPIONS_CACHE[server] = disk
        return CHAMPIONS_CACHE[server]

    # No disk cache -- fetch from CDragon
    cdragon_url = CDRAGON_TFT_URLS.get(server, CDRAGON_TFT_URLS["PBE"])
    try:
        with httpx.Client(timeout=CDRAGON_TIMEOUT) as client:
            resp = client.get(cdragon_url)
            resp.raise_for_status()
            data = resp.json()

        champions = parse_champions_data(data)
        CHAMPIONS_CACHE[server] = champions
        _save_champions_cache_to_disk(server, champions)
    except Exception:
        return []

    return CHAMPIONS_CACHE.get(server, [])
