"""
Recomputes AggregatedUnitStat rows from raw UnitUsage + Participant data.

This is a pure database operation and can be called from management commands,
signals, or any other synchronous Django context.
"""
import logging

from django.db.models import Count, Q, Sum

logger = logging.getLogger(__name__)


def recompute_unit_stats(server: str | None = None) -> int:
    """
    For every unit that has at least one UnitUsage row, compute:
      - games          : total UnitUsage rows
      - total_placement: sum of linked Participant.placement
      - avg_placement  : total_placement / games
      - top4_rate      : placements <= 4  / games
      - win_rate       : placements == 1  / games

    For PBE, stats are computed separately for each (match_category, match_tier)
    combination: PROJECT_PBE/tier1, PROJECT_PBE/tier2, PROJECT_PBE/open, PRO_RANDOM.

    For LIVE/SCRIMS, stats are computed once with no category/tier split.

    Upserts into AggregatedUnitStat.
    Returns the number of unit rows updated/created.
    """
    from tracker.models import AggregatedUnitStat, UnitUsage  # avoid circular import

    servers = [server] if server else ["PBE", "LIVE", "SCRIMS"]
    updated = 0

    for srv in servers:
        if srv == "PBE":
            # Compute stats per category/tier for PBE
            categories = [
                ("PROJECT_PBE", "tier1"),
                ("PROJECT_PBE", "tier2"),
                ("PROJECT_PBE", "open"),
                ("PRO_RANDOM", None),
            ]
        else:
            categories = [(None, None)]

        for cat, tier in categories:
            qs = UnitUsage.objects.filter(
                participant__match__server=srv,
                participant__counts_for_stats=True,
            )
            if cat:
                qs = qs.filter(participant__match__match_category=cat)
            if tier:
                qs = qs.filter(participant__match__match_tier=tier)

            aggregated = qs.values("unit").annotate(
                games=Count("id"),
                total_placement=Sum("participant__placement"),
                top4_count=Count("id", filter=Q(participant__placement__lte=4)),
                win_count=Count("id", filter=Q(participant__placement=1)),
            )

            for row in aggregated:
                unit_id = row["unit"]
                games = row["games"]
                total_placement = row["total_placement"] or 0
                top4_count = row["top4_count"]
                win_count = row["win_count"]

                AggregatedUnitStat.objects.update_or_create(
                    unit_id=unit_id,
                    server=srv,
                    match_category=cat,
                    match_tier=tier,
                    defaults={
                        "games": games,
                        "total_placement": total_placement,
                        "avg_placement": total_placement / games if games else 0.0,
                        "top4_rate": top4_count / games if games else 0.0,
                        "win_rate": win_count / games if games else 0.0,
                    },
                )
                updated += 1

    logger.info("Recomputed aggregated stats for %d unit(s).", updated)
    return updated
