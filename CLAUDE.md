# TFT PBE Match Tracker — CLAUDE.md

## What this project is

Django 5 + DRF backend that tracks TFT PBE matches for a fixed list of ~150 Riot IDs.
It fetches matches from the Riot API, stores participants and unit usage, and exposes
aggregated per-unit statistics via a REST API.

## Stack

- Python 3.12, Django 5, Django REST Framework
- httpx (async HTTP client)
- SQLite (default) / PostgreSQL via DATABASE_URL
- No Celery, no Redis, no Docker

## Project layout

```
backend/
├── manage.py
├── requirements.txt
├── .env                          # RIOT_API_KEY, SECRET_KEY, DEBUG, DATABASE_URL
├── tft_tracker/                  # Django project package
│   └── settings.py
└── tracker/                      # Main app
    ├── models.py                 # Player, Match, Participant, Unit, UnitUsage, AggregatedUnitStat
    ├── serializers.py
    ├── views.py                  # GET /api/unit-stats/
    ├── urls.py
    ├── services/
    │   ├── riot_api.py           # Async Riot API client (semaphore + retry)
    │   ├── aggregation.py        # recompute_unit_stats()
    │   └── match_processor.py   # process_match() — parse & persist
    └── management/commands/
        ├── fetch_puuid.py        # One-time: resolve Riot IDs → PUUIDs
        └── fetch_pbe.py          # Periodic: fetch today's matches
```

## Models

| Model | Key fields |
|---|---|
| Player | game_name, tag_line, puuid (unique) |
| Match | match_id (PK), game_datetime, raw_json |
| Participant | FK Match + FK Player (nullable), puuid, placement, level, gold_left |
| Unit | character_id (unique) |
| UnitUsage | FK Participant + FK Unit, star_level, rarity, items (JSONField) |
| AggregatedUnitStat | OneToOne Unit, games, avg_placement, top4_rate, win_rate |

Cascade: deleting a Match cascades to Participant → UnitUsage.

## Management commands

### `python manage.py fetch_puuid`
- Resolves all ~150 hardcoded Riot IDs → PUUIDs via `/riot/account/v1/accounts/by-riot-id/`
- Stores results in the Player table
- Only fetches players NOT already in DB (case-insensitive check)
- Run once; re-run if player list changes

### `python manage.py fetch_pbe`
Fetches today's TFT matches for all tracked players.

**Options:**
```bash
python manage.py fetch_pbe                        # all players
python manage.py fetch_pbe --player DarthNub      # single player (case-insensitive)
python manage.py fetch_pbe --match PBE1_452503    # force-store a specific match ID
```

**Flow:**
1. Load all players with PUUIDs from DB
2. For each player: fetch match IDs with `startTime` = today 00:00 UTC in **milliseconds**
3. Skip match IDs already in DB
4. Fetch each new match JSON; if `game_date < today_utc` → `break` (API returns newest first)
5. Skip if fewer than 4 of the 8 participants are tracked players
6. `process_match()` stores Match + Participant + UnitUsage (uses `get_or_create`, safe against duplicates)
7. After all players: `recompute_unit_stats()` if anything new was stored

**`--match` mode** bypasses date filter and the 4-player check — stores the match unconditionally.

## Riot API client (`riot_api.py`)

- Base URL: `https://americas.api.riotgames.com`
- `asyncio.Semaphore(5)` — max 5 concurrent in-flight requests
- Exponential backoff on 429 (uses `Retry-After` header), max 6 retries
- Returns `None` on 404 or exhausted retries
- `startTime` for `get_match_ids` is in **milliseconds** (PBE API quirk)

## REST API

```
GET /api/unit-stats/
```

| Param | Default | Description |
|---|---|---|
| sort | avg_placement | avg_placement, games, win_rate, top4_rate |
| min_games | — | exclude units below this threshold |
| search | — | case-insensitive substring on character_id |

Response shape:
```json
[{ "unit_name": "TFT14_Ahri", "games": 42, "avg_placement": 3.21, "top4_rate": 0.71, "win_rate": 0.19 }]
```

## Async / ORM boundary — CRITICAL

Django ORM must **never** be called from async context.
Pattern used throughout:
- `handle()` is fully synchronous
- `asyncio.run()` is called only for pure HTTP helpers (`_fetch_*_async`)
- All DB reads/writes stay in `handle()` or helper sync methods

## Player list

- Defined in `fetch_puuid.py` as `_RAW_PLAYER_LIST`
- Format: `GameName#TagLine` (entries without `#` default to tag_line=`pbe`)
- Unicode directional chars (`U+2066`, `U+2069`) are stripped automatically
- Deduplication is case-insensitive

## Common DB operations

```bash
# Clear all matches (cascades to Participant, UnitUsage)
python manage.py shell -c "from tracker.models import Match; Match.objects.all().delete()"

# Clear stats only
python manage.py shell -c "from tracker.models import AggregatedUnitStat; AggregatedUnitStat.objects.all().delete()"

# Clear players (cascades everything)
python manage.py shell -c "from tracker.models import Player; Player.objects.all().delete()"
```

## Environment variables (`.env`)

```
RIOT_API_KEY=RGAPI-...
SECRET_KEY=...
DEBUG=True
DATABASE_URL=          # blank = SQLite; postgresql://user:pass@host/db for Postgres
```
