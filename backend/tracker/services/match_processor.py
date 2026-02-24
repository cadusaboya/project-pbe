"""
match_processor.py

Parses a raw TFT match JSON blob (from Riot API) and persists:
  - Match            (one row per match)
  - Participant      (one row per participant — all 8, tracked or not)
  - Unit / UnitUsage (one row per champion slot per participant)

For untracked participants, a Player record is created on-the-fly using
the riotIdGameName / riotIdTagLine fields present in the match JSON.
"""
import datetime
import logging

logger = logging.getLogger(__name__)


def process_match(match_data: dict, puuid_to_player: dict, game_version: str = "16.6 B", server: str = "PBE") -> bool:
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
    from tracker.models import Match, Participant, Player, Unit, UnitUsage  # avoid top-level circular

    match_id: str = match_data["metadata"]["match_id"]
    game_datetime_ms: int = match_data["info"]["game_datetime"]
    game_datetime = datetime.datetime.fromtimestamp(
        game_datetime_ms / 1000.0, tz=datetime.timezone.utc
    )

    match, created = Match.objects.get_or_create(
        match_id=match_id,
        defaults={
            "game_datetime": game_datetime,
            "game_version": game_version,
            "server": server,
            "raw_json": match_data,
        },
    )

    if not created:
        logger.debug("Match %s already in DB — skipping.", match_id)
        return False

    participants_data: list[dict] = match_data.get("info", {}).get("participants", [])
    tracked_count = 0

    for p_data in participants_data:
        puuid: str = p_data.get("puuid", "")
        if not puuid:
            continue

        # Use existing tracked player or create a new Player record on-the-fly.
        player = puuid_to_player.get(puuid)
        if player is None:
            game_name: str = p_data.get("riotIdGameName") or puuid[:16]
            tag_line: str = p_data.get("riotIdTagLine") or "unknown"
            player, player_created = Player.objects.get_or_create(
                puuid=puuid,
                defaults={"game_name": game_name, "tag_line": tag_line},
            )
            if player_created:
                logger.info("New player created on-the-fly: %s#%s", game_name, tag_line)
        else:
            tracked_count += 1

        participant, _ = Participant.objects.get_or_create(
            match=match,
            puuid=puuid,
            defaults={
                "player": player,
                "placement": p_data.get("placement", 0),
                "level": p_data.get("level", 1),
                "gold_left": p_data.get("gold_left", 0),
            },
        )

        unit_usages: list[UnitUsage] = []
        for unit_data in p_data.get("units", []):
            character_id: str = unit_data.get("character_id", "")
            if not character_id:
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

    logger.info(
        "Stored match %s — %d/%d participants were tracked players.",
        match_id,
        tracked_count,
        len(participants_data),
    )
    return True
