"""
Shared utilities for tracker view modules.
"""

from django.db.models import Q
from rest_framework.response import Response


VALID_TIERS = {"tier1", "tier2", "open"}
VALID_QUEUES = {"project_pbe", "pro_random"}


def get_tier(request) -> str | list[str] | None:
    """Extract and validate tier query param.

    Supports comma-separated values for multi-tier aggregation,
    e.g. ``?tier=tier1,tier2``.  Returns a single string when one tier
    is requested, a list when several are, or None if nothing valid.
    """
    raw = request.query_params.get("tier", "").strip().lower()
    if not raw:
        return None
    parts = [t.strip() for t in raw.split(",") if t.strip() in VALID_TIERS]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return parts


def tier_q(tier, field: str) -> Q:
    """Build a Q filter for tier (single string or list)."""
    if isinstance(tier, list):
        return Q(**{f"{field}__in": tier})
    return Q(**{field: tier})


def get_queue(request) -> str | None:
    """Extract and validate queue query param (project_pbe or pro_random)."""
    queue = request.query_params.get("queue", "").strip().lower()
    return queue if queue in VALID_QUEUES else None


def pbe_participant_filter(request, prefix: str = "") -> Q:
    """
    Build Q filter for PBE participants based on queue + tier params.

    For PROJECT_PBE: filter by match category/tier, use counts_for_stats=True.
    For PRO_RANDOM: filter by match category, use counts_for_stats=True.

    The prefix is prepended to field names for use in related lookups,
    e.g. prefix="participations__" for Player-level queries.
    """
    queue = get_queue(request)
    tier = get_tier(request)

    p = prefix  # shorthand

    if queue == "project_pbe":
        q = Q(**{f"{p}match__match_category": "PROJECT_PBE", f"{p}counts_for_stats": True})
        if tier:
            if isinstance(tier, list):
                q &= Q(**{f"{p}match__match_tier__in": tier})
            else:
                q &= Q(**{f"{p}match__match_tier": tier})
        return q
    elif queue == "pro_random":
        return Q(**{f"{p}match__match_category": "PRO_RANDOM", f"{p}counts_for_stats": True})
    else:
        # No queue specified — if tier is set, filter by player tier (backward compat)
        if tier:
            if isinstance(tier, list):
                return Q(**{f"{p}player__isnull": False, f"{p}player__tier__in": tier})
            else:
                return Q(**{f"{p}player__isnull": False, f"{p}player__tier": tier})
        return Q(**{f"{p}player__isnull": False})


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
