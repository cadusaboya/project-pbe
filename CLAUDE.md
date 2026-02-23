# TFT Pro Radar — CLAUDE.md

## What this project is

Full-stack TFT PBE match tracker (Django 5 + Next.js 15) that tracks matches for ~150
pro players on the PBE server. It fetches matches from the Riot API, stores participants,
unit usage, and item data, then exposes aggregated statistics, composition analysis, and
player profiles via a REST API consumed by a Next.js frontend.

**Domain:** tftproradar.com

## Stack

### Backend
- Python 3.12, Django 5, Django REST Framework
- httpx (async HTTP client)
- SQLite (default) / PostgreSQL via DATABASE_URL
- Gunicorn (production WSGI)
- No Celery, no Redis, no Docker

### Frontend
- Next.js 15 (App Router), React 19, TypeScript 5
- Tailwind CSS 3.4 (custom TFT color theme)
- Vercel Analytics
- No Redux/Zustand — simple hooks + URL query params for state

## Project layout

```
backend/
├── manage.py
├── requirements.txt
├── Procfile
├── .env                              # RIOT_API_KEY, SECRET_KEY, DEBUG, DATABASE_URL
├── item_assets.json                  # Item ID → CDragon image URL mapping
├── item_names.json                   # Item ID → display name mapping
├── tft_tracker/                      # Django project package
│   ├── settings.py
│   ├── urls.py                       # Root routing: api/ → tracker.urls
│   └── wsgi.py
└── tracker/                          # Main app
    ├── models.py                     # Player, Match, Participant, Unit, UnitUsage, AggregatedUnitStat, Comp
    ├── serializers.py
    ├── views.py                      # 18+ REST endpoints
    ├── urls.py
    ├── services/
    │   ├── riot_api.py               # Async Riot API client (semaphore + retry)
    │   ├── aggregation.py            # recompute_unit_stats()
    │   └── match_processor.py        # process_match() — parse & persist
    └── management/commands/
        ├── fetch_puuid.py            # One-time: resolve Riot IDs → PUUIDs
        ├── fetch_pbe.py              # Periodic: fetch today's matches
        ├── fetch_pbe_loop.py         # Daemon for continuous fetching
        ├── fetch_item_data.py        # Populate CDragon item metadata
        ├── fetch_unit_data.py        # Populate CDragon unit metadata
        ├── update_unit_stats.py      # Manual stats recomputation
        ├── top_comps.py              # Composition analysis
        ├── top_compositions.py
        ├── suggest_comps.py          # Comp recommendations
        ├── delete_comp.py            # Data cleanup
        ├── delete_matches_before_cutoff.py
        └── fix_pbe_game_version.py   # Fix game version labels

frontend/
├── package.json
├── next.config.ts                    # API rewrites → backend, CDragon images
├── tailwind.config.ts                # TFT color theme
├── tsconfig.json
└── src/
    ├── lib/
    │   └── backend.ts                # Backend URL helper (dev/prod)
    └── app/
        ├── layout.tsx                # Root layout (header, nav, stats bar)
        ├── page.tsx                  # Landing page
        ├── globals.css
        ├── components/
        │   ├── Nav.tsx               # Navigation (7 main links)
        │   ├── StatsBar.tsx          # Live stats display
        │   ├── StatsTable.tsx        # Reusable unit stats table
        │   ├── CompsList.tsx         # Composition list with flex combos
        │   ├── WinningCompsList.tsx  # 1st place comps
        │   ├── DataExplorer.tsx      # Advanced filtering for /explore
        │   ├── ItemsExplorer.tsx     # Per-unit item analysis
        │   ├── SearchComps.tsx       # Search by unit(s)
        │   ├── PlayerProfile.tsx     # Player detail view
        │   └── PlayerStatsList.tsx   # Player rankings
        ├── unit-stats/page.tsx
        ├── comps/page.tsx
        ├── comps/hidden/page.tsx     # Auto-discovered comps
        ├── items/page.tsx
        ├── search/page.tsx
        ├── games-feed/page.tsx
        ├── players/page.tsx
        ├── player/[name]/page.tsx    # Dynamic player profile
        ├── explore/page.tsx          # Advanced data explorer
        └── last-games/page.tsx
```

## Models

| Model | Key fields |
|---|---|
| Player | game_name, tag_line, puuid (unique), last_seen_match_id, last_polled_at |
| Match | match_id (PK), game_datetime, game_version, raw_json, created_at |
| Participant | FK Match + FK Player (nullable), puuid, placement, level, gold_left |
| Unit | character_id (unique), cost, traits (JSONField) |
| UnitUsage | FK Participant + FK Unit, star_level, rarity, items (JSONField) |
| AggregatedUnitStat | OneToOne Unit, games, total_placement, avg_placement, top4_rate, win_rate |
| Comp | name (unique), units, target_level, excluded_units, excluded_unit_counts, required_traits, required_unit_counts, required_unit_star_levels, required_unit_item_counts, required_trait_breakpoints, excluded_traits, is_active |

Cascade: deleting a Match cascades to Participant → UnitUsage.

## REST API

**Base path:** `/api/`

| Endpoint | Method | Purpose | Key Params |
|---|---|---|---|
| `/stats/` | GET | Global stats (matches, players, last fetch) | game_version |
| `/unit-stats/` | GET | All unit statistics | sort, min_games, search, game_version |
| `/unit-stats/<unit_name>/star-stats/` | GET | Star level + item breakdowns for a unit | game_version |
| `/item-stats/` | GET | Per-unit item statistics | unit (required), game_version, min_games, selected_item |
| `/explore/` | GET | Advanced filtering by units/traits/items/levels | require_unit, ban_unit, require_trait, exclude_trait, require_item_on_unit, exclude_item, player_level, game_version |
| `/comps/` | GET | Curated comp stats with flex combos | game_version, limit, top_flex |
| `/comps/hidden/` | GET | Auto-discovered core comps | game_version, limit, core_sizes, min_occurrences, target_level, top_flex |
| `/winning-comps/` | GET | 1st-place comps from matches | limit, game_version |
| `/search-comps/` | GET | Search comps by required units | unit (repeatable), game_version, limit, sort |
| `/versions/` | GET | Distinct game versions | — |
| `/traits/` | GET | Trait breakpoints & CDragon icons | — |
| `/item-assets/` | GET | Item ID → URL & name mappings | — |
| `/match/<match_id>/lobby` | GET | Full match lobby (all 8 participants) | — |
| `/player/<player_name>/profile/` | GET | Player detail + match history | game_version |
| `/players/` | GET | All tracked players | — |
| `/player-stats/` | GET | Player rankings & aggregated stats | sort, search, min_games |

**Unit Stats response shape:**
```json
[{ "unit_name": "TFT16_Ahri", "cost": 2, "traits": ["Spiritblossom", "Sorceress"], "games": 142, "avg_placement": 3.21, "top4_rate": 0.71, "win_rate": 0.19 }]
```

## Frontend pages & navigation

| Route | Description |
|---|---|
| `/` | Landing page — hero, features grid, CTAs |
| `/comps` | Curated compositions with flex combos |
| `/comps/hidden` | Auto-discovered core compositions |
| `/unit-stats` | Unit statistics with sorting/filtering |
| `/items` | Item explorer — per-unit item analysis |
| `/search` | Search comps by unit(s) |
| `/games-feed` | Recent match feed |
| `/players` | Player rankings |
| `/player/[name]` | Individual player profile |
| `/explore` | Advanced data explorer (boolean filters) |

## Frontend data fetching

- **Server components** fetch data with ISR (60s revalidation)
- **Client components** (`"use client"`) for interactive filtering, URL state sync
- **Backend URL:** dev → `http://localhost:8000`, prod → `https://project-pbe-production.up.railway.app`
- **Caching:** Backend sets `Cache-Control` headers (5 min–5 hours depending on endpoint)
- **Suspense boundaries** for async loading states

## Management commands

### `python manage.py fetch_puuid`
- Resolves all ~150 hardcoded Riot IDs → PUUIDs
- Stores results in the Player table
- Only fetches players NOT already in DB (case-insensitive check)
- Run once; re-run if player list changes

### `python manage.py fetch_pbe`
Fetches today's TFT matches for all tracked players.

```bash
python manage.py fetch_pbe                        # all players
python manage.py fetch_pbe --player DarthNub      # single player
python manage.py fetch_pbe --match PBE1_452503    # force-store a match
```

**Flow:**
1. Load all players with PUUIDs from DB
2. For each player: fetch match IDs with `startTime` = today 00:00 UTC in **milliseconds**
3. Skip match IDs already in DB
4. Fetch each new match JSON; if `game_date < today_utc` → `break`
5. Skip if fewer than 4 of the 8 participants are tracked players
6. `process_match()` stores Match + Participant + UnitUsage (idempotent via `get_or_create`)
7. After all players: `recompute_unit_stats()` if anything new was stored

`--match` mode bypasses date filter and the 4-player check.

### Other commands
- `fetch_pbe_loop` — Daemon for continuous fetching
- `fetch_item_data` / `fetch_unit_data` — Sync metadata from CDragon
- `update_unit_stats` — Manual stats recomputation
- `top_comps` / `top_compositions` / `suggest_comps` — Analysis tools
- `delete_comp` / `delete_matches_before_cutoff` — Data cleanup
- `fix_pbe_game_version` — Fix game version labels

## Riot API client (`riot_api.py`)

- Base URL: `https://americas.api.riotgames.com`
- `asyncio.Semaphore(5)` — max 5 concurrent in-flight requests
- Exponential backoff on 429 (uses `Retry-After` header), max 6 retries
- Returns `None` on 404 or exhausted retries
- `startTime` for `get_match_ids` is in **milliseconds** (PBE API quirk)

## Async / ORM boundary — CRITICAL

Django ORM must **never** be called from async context.
Pattern used throughout:
- `handle()` is fully synchronous
- `asyncio.run()` is called only for pure HTTP helpers (`_fetch_*_async`)
- All DB reads/writes stay in `handle()` or helper sync methods

## Key architectural patterns

### Composition analysis
- **Curated comps** (`Comp` model): manually defined with constraints (required/excluded units, traits, star levels, item counts, trait breakpoints)
- **Hidden comps** (auto-discovered): generates all unit combinations of sizes 4-6, filters by frequency, ranks flex combos
- **Weighted slots**: Atakhan/Galio = 0 slots, Baron = 2 slots, others = 1

### Advanced filtering (Explore)
- Complex boolean filter builder: require/ban units, traits, items, levels
- Delta calculations vs. baseline stats
- Iterator-based processing for large datasets

### Caching strategy
- Backend in-process caches: trait data (1h TTL), item assets (persistent), versions (5min), players (5min)
- HTTP `Cache-Control` headers per endpoint
- Frontend ISR: 60s revalidation

### Game version support
- Configurable switchover date/time for different patches
- `game_version` filter on most endpoints
- Backward-compatible version field on Match

## Tailwind TFT theme

```
tft-bg: #0a0e1a       tft-surface: #111827    tft-border: #1f2a40
tft-accent: #c89b3c   tft-gold: #f0b429       tft-text: #e2e8f0
tft-muted: #64748b     tft-hover: #1e2d4a
```

## Player list

- Defined in `fetch_puuid.py` as `_RAW_PLAYER_LIST`
- Format: `GameName#TagLine` (entries without `#` default to tag_line=`pbe`)
- Unicode directional chars (`U+2066`, `U+2069`) are stripped automatically
- Deduplication is case-insensitive

## Deployment

- **Backend:** Railway (Gunicorn, 4 workers, 4 threads, auto-migrate on deploy)
- **Frontend:** Vercel or Railway
- **Database:** PostgreSQL on Railway (production), SQLite (local)

**Procfile:**
```
web: cd backend && python manage.py migrate --noinput && gunicorn tft_tracker.wsgi --bind 0.0.0.0:$PORT --workers 4 --threads 4 --timeout 60
```

## Common DB operations

```bash
# Clear all matches (cascades to Participant, UnitUsage)
python manage.py shell -c "from tracker.models import Match; Match.objects.all().delete()"

# Clear stats only
python manage.py shell -c "from tracker.models import AggregatedUnitStat; AggregatedUnitStat.objects.all().delete()"

# Clear players (cascades everything)
python manage.py shell -c "from tracker.models import Player; Player.objects.all().delete()"
```

## Environment variables

### Backend (`.env`)
```
RIOT_API_KEY=RGAPI-...
SECRET_KEY=...
DEBUG=True
DATABASE_URL=          # blank = SQLite; postgresql://user:pass@host/db for Postgres
ALLOWED_HOSTS=localhost,127.0.0.1,*.railway.app
```

### Frontend
```
NODE_ENV=development|production
BACKEND_URL=http://localhost:8000       # dev override
NEXT_PUBLIC_BACKEND_URL=...             # public override
```
