"""
Shared utilities for tracker view modules.
"""

from rest_framework.response import Response


VALID_TIERS = {"tier1", "tier2", "open"}


def get_tier(request) -> str | None:
    """Extract and validate tier query param. Returns None if not set or invalid."""
    tier = request.query_params.get("tier", "").strip().lower()
    return tier if tier in VALID_TIERS else None


def cc(response: Response, max_age: int) -> Response:
    """Set Cache-Control header on a DRF Response."""
    response["Cache-Control"] = f"public, max-age={max_age}"
    return response


SORT_MAP = {
    "avg_placement": "avg_placement",
    "games": "-games",
    "win_rate": "-win_rate",
    "top4_rate": "-top4_rate",
}


def unit_slot_weight(character_id: str) -> int:
    """Board slot weight rules for special units."""
    name = str(character_id or "").strip().lower()
    if not name:
        return 1
    if "atakhan" in name or name.endswith("_galio"):
        return 0
    if "baron" in name:
        return 2
    return 1


def slots_used(units) -> int:
    return sum(unit_slot_weight(u) for u in units)
