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

    When *server* is given (e.g. "PBE" or "LIVE"), only matches on that
    server are considered and the corresponding AggregatedUnitStat rows
    are upserted.  When *server* is None, both servers are recomputed.

    Upserts into AggregatedUnitStat.
    Returns the number of unit rows updated/created.
    """
    from tracker.models import AggregatedUnitStat, UnitUsage  # avoid circular import

    servers = [server] if server else ["PBE", "LIVE"]
    updated = 0

    for srv in servers:
        qs = UnitUsage.objects.filter(participant__match__server=srv)
        if srv == "LIVE":
            qs = qs.filter(participant__player__isnull=False)

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
