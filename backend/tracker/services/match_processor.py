"""
match_processor.py

Parses a raw TFT match JSON blob (from Riot API) and persists:
  - Match            (one row per match)
  - Participant      (one row per participant — all 8, tracked or not)
  - Unit / UnitUsage (one row per champion slot per participant)

Untracked participants are stored with player=NULL.
"""
import datetime
import logging

logger = logging.getLogger(__name__)

# Units to ignore entirely (spawned minions with no HUD image, etc.)
SKIP_UNITS = {"tft17_bardfollower"}


def classify_pbe_match(participant_puuids: list[str], puuid_to_player: dict) -> tuple[str, str | None]:
    """
    Classify a PBE match based on player tiers.

    A match is PROJECT_PBE of a specific tier if at least 6 of 8 players
    belong to that tier. Otherwise it's PRO_RANDOM.

    Returns:
        (match_category, match_tier):
        - ("PROJECT_PBE", "tier1"|"tier2"|"open") if 6+ players share a tier
        - ("PRO_RANDOM", None) otherwise
    """
    tier_counts: dict[str, int] = {"tier1": 0, "tier2": 0, "open": 0}
    for puuid in participant_puuids:
        player = puuid_to_player.get(puuid)
        if player and player.tier:
            tier_counts[player.tier] = tier_counts.get(player.tier, 0) + 1

    for tier, count in tier_counts.items():
        if count >= 5:
            return ("PROJECT_PBE", tier)

    return ("PRO_RANDOM", None)


def process_match(match_data: dict, puuid_to_player: dict, game_version: str = "17 B", server: str = "PBE") -> bool:
    """
    Store a match and the unit data for every participant (all 8 slots).

    Args:
        match_data:       Full match JSON from Riot API.
        puuid_to_player:  {puuid: Player instance} for all tracked players.
        server:           "PBE" or "LIVE".

    Returns:
        True  — match was new and has been stored.
        False — match already existed in the database; nothing changed.
    """
    from tracker.models import Match, Participant, Unit, UnitUsage  # avoid top-level circular

    match_id: str = match_data["metadata"]["match_id"]
    game_datetime_ms: int = match_data["info"]["game_datetime"]
    game_datetime = datetime.datetime.fromtimestamp(
        game_datetime_ms / 1000.0, tz=datetime.timezone.utc
    )

    # Classify PBE matches before creating
    participants_data: list[dict] = match_data.get("info", {}).get("participants", [])
    participant_puuids = [p.get("puuid", "") for p in participants_data if p.get("puuid")]

    match_category = None
    match_tier = None
    if server == "PBE":
        match_category, match_tier = classify_pbe_match(participant_puuids, puuid_to_player)
        if match_category != "PROJECT_PBE":
            logger.info("Skipping non-PROJECT_PBE match %s (category=%s).", match_id, match_category)
            return False

    match, created = Match.objects.get_or_create(
        match_id=match_id,
        defaults={
            "game_datetime": game_datetime,
            "game_version": game_version,
            "server": server,
            "raw_json": match_data,
            "match_category": match_category,
            "match_tier": match_tier,
        },
    )

    if not created:
        logger.debug("Match %s already in DB — skipping.", match_id)
        return False

    tracked_count = 0

    for p_data in participants_data:
        puuid: str = p_data.get("puuid", "")
        if not puuid:
            continue

        # Use existing tracked player or store with player=NULL.
        player = puuid_to_player.get(puuid)
        if player is not None:
            tracked_count += 1

        # For PROJECT_PBE matches, all 8 participants count for stats.
        # For PRO_RANDOM or non-PBE, only tracked players count.
        if match_category == "PROJECT_PBE":
            counts = True
        else:
            counts = player is not None

        participant, _ = Participant.objects.get_or_create(
            match=match,
            puuid=puuid,
            defaults={
                "player": player,
                "placement": p_data.get("placement", 0),
                "level": p_data.get("level", 1),
                "gold_left": p_data.get("gold_left", 0),
                "counts_for_stats": counts,
            },
        )

        unit_usages: list[UnitUsage] = []
        for unit_data in p_data.get("units", []):
            character_id: str = unit_data.get("character_id", "")
            if not character_id or character_id.lower() in SKIP_UNITS:
                continue

            unit, _ = Unit.objects.get_or_create(character_id=character_id)

            unit_usages.append(
                UnitUsage(
                    participant=participant,
                    unit=unit,
                    star_level=unit_data.get("tier", 1),
                    rarity=unit_data.get("rarity", 0),
                    items=unit_data.get("itemNames", []),
                )
            )

        if unit_usages:
            UnitUsage.objects.bulk_create(unit_usages)

    category_label = f" [{match_category}{'/' + match_tier if match_tier else ''}]" if match_category else ""
    logger.info(
        "Stored match %s%s — %d/%d participants were tracked players.",
        match_id,
        category_label,
        tracked_count,
        len(participants_data),
    )
    return True
