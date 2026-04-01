"""
Item asset loading and canonical item ID mapping.

Provides helpers to load item_assets.json / item_names.json and a canonical
mapping that merges duplicate item IDs (e.g. Corrupted variants) by display name.
"""

import json
from collections import defaultdict
from pathlib import Path

from django.conf import settings

# ── File paths ────────────────────────────────────────────────────────────────

ITEM_ASSETS_FILE = Path(settings.BASE_DIR) / "item_assets.json"
ITEM_NAMES_FILE = Path(settings.BASE_DIR) / "item_names.json"

# ── In-memory caches ─────────────────────────────────────────────────────────

_ITEM_ASSETS_CACHE: dict | None = None
_ITEM_NAMES_CACHE: dict | None = None
_ITEM_CANONICAL_MAP: dict[str, str] | None = None


# ── Public API ────────────────────────────────────────────────────────────────

def load_item_assets() -> dict:
    """Return the item-assets dict, loading from disk on first call."""
    global _ITEM_ASSETS_CACHE
    if _ITEM_ASSETS_CACHE is None:
        try:
            _ITEM_ASSETS_CACHE = json.loads(ITEM_ASSETS_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _ITEM_ASSETS_CACHE = {}
    return _ITEM_ASSETS_CACHE


def load_item_names() -> dict:
    """Return the item-names dict, loading from disk on first call."""
    global _ITEM_NAMES_CACHE
    if _ITEM_NAMES_CACHE is None:
        try:
            _ITEM_NAMES_CACHE = json.loads(ITEM_NAMES_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _ITEM_NAMES_CACHE = {}
    return _ITEM_NAMES_CACHE


def get_item_canonical_map() -> dict[str, str]:
    """Return {item_id: canonical_item_id} mapping, merging IDs that share a display name."""
    global _ITEM_CANONICAL_MAP
    if _ITEM_CANONICAL_MAP is not None:
        return _ITEM_CANONICAL_MAP

    names = load_item_names()

    # Group IDs by display name
    name_to_ids: dict[str, list[str]] = defaultdict(list)
    for item_id, display_name in (names or {}).items():
        name_to_ids[display_name].append(item_id)

    # Suffixes/prefixes that indicate a non-canonical variant
    _VARIANT_MARKERS = ("Corrupted", "Tutorial", "Assist", "AcademyCopy", "Encounter", "ChoiceItem")

    canonical_map: dict[str, str] = {}
    for display_name, ids in name_to_ids.items():
        if len(ids) == 1:
            canonical_map[ids[0]] = ids[0]
            continue

        # Pick canonical: prefer IDs starting with TFT_Item_ and without variant markers
        def _score(iid: str) -> tuple:
            has_marker = any(m in iid for m in _VARIANT_MARKERS)
            starts_tft_item = iid.startswith("TFT_Item_")
            return (not has_marker, starts_tft_item, -len(iid), iid)

        ids.sort(key=_score, reverse=True)
        canonical = ids[0]
        for iid in ids:
            canonical_map[iid] = canonical

    _ITEM_CANONICAL_MAP = canonical_map
    return _ITEM_CANONICAL_MAP
