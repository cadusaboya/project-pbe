# TFT Pro Radar — CLAUDE.md

## What this project is

Full-stack TFT match tracker (Django 5 + Next.js 15) that tracks matches for pro players
on **two servers**: PBE (~285 players) and LIVE (~45 players across NA/KR/EUW/LAS).
It fetches matches from the Riot API, stores participants, unit usage, and item data,
then exposes aggregated statistics, composition analysis, and player profiles via a
REST API consumed by a Next.js frontend.

**Domain:** tftproradar.com
**Current TFT Set:** Set 16 (all unit prefixes are `TFT16_`)

## Stack

### Backend
- Python 3.12, Django 5, Django REST Framework
- httpx (async HTTP client for Riot API)
- SQLite (default) / PostgreSQL via DATABASE_URL
- Gunicorn (production WSGI)
- No Celery, no Redis, no Docker

### Frontend
- Next.js 15 (App Router), React 19, TypeScript 5
- Tailwind CSS 3.4 (custom TFT color theme)
- Vercel Analytics + Speed Insights
- No Redux/Zustand — hooks + URL query params for state

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
│   ├── settings.py                   # CORS_ALLOW_ALL_ORIGINS, JSONRenderer only
│   ├── urls.py                       # /admin/ + /api/ → tracker.urls
│   └── wsgi.py
└── tracker/                          # Main app
    ├── models.py                     # Player, Match, Participant, Unit, UnitUsage, AggregatedUnitStat, Comp
    ├── serializers.py                # UnitStatSerializer, WinningUnitSerializer, WinningCompSerializer
    ├── views.py                      # 18+ REST endpoints (APIView + ListAPIView)
    ├── urls.py
    ├── services/
    │   ├── riot_api.py               # Async Riot API client (semaphore + retry + region routing)
    │   ├── aggregation.py            # recompute_unit_stats(server=None)
    │   └── match_processor.py        # process_match(data, puuid_map, version, server)
    └── management/commands/
        ├── fetch_puuid.py            # PBE: resolve ~285 Riot IDs → PUUIDs (region="PBE")
        ├── fetch_live_puuid.py       # LIVE: resolve ~45 Riot IDs → PUUIDs (region=NA1/KR/EUW1/etc.)
        ├── fetch_pbe.py              # PBE: fetch recent matches (MIN_TRACKED=6, date cutoff)
        ├── fetch_live.py             # LIVE: fetch recent matches (MIN_TRACKED=1, version filter)
        ├── fetch_pbe_loop.py         # Daemon: continuous PBE fetching
        ├── fetch_item_data.py        # CDragon → item_assets.json + item_names.json
        ├── fetch_unit_data.py        # CDragon → Unit model (cost, traits)
        ├── update_unit_stats.py      # Manual recompute_unit_stats()
        ├── upsert_comp.py            # Create/update Comp with constraints
        ├── top_comps.py              # Comp analysis (full boards or N-highest-cost core)
        ├── top_compositions.py       # Exact K-unit combinations frequency
        ├── suggest_comps.py          # Auto-discover comp archetypes
        ├── delete_comp.py            # Delete Comp(s) by name
        ├── delete_matches_before_cutoff.py  # Cleanup old matches (env-configurable cutoff)
        ├── fix_pbe_game_version.py   # Bulk-fix game_version by switchover datetime
        └── convert_game_version.py   # Rename game_version labels

frontend/
├── package.json                      # Next 15.1.7, React 19, Tailwind 3.4.17
├── next.config.ts                    # API rewrites, CDragon image domains
├── tailwind.config.ts                # TFT color theme
├── tsconfig.json
└── src/
    ├── middleware.ts                  # Redirects /comps → /pbe/comps, validates server param
    ├── lib/
    │   ├── backend.ts                # Backend URL builder (dev/prod)
    │   ├── api.ts                    # ISR cache-busting: getDataVersion(), fetchApi(), fetchJson()
    │   └── tftUtils.ts              # unitImageUrl(), itemImageUrl(), formatUnit(), costBorderColor()
    └── app/
        ├── layout.tsx                # Root layout: header, ServerSelector, Nav, StatsBar, FreshnessGuard
        ├── page.tsx                  # Landing page with quick stats
        ├── globals.css               # Inter font, custom scrollbar, loading animation
        ├── api/freshness/route.ts    # Proxy to /api/data-version/ (force-dynamic, no-store)
        ├── components/
        │   ├── Nav.tsx               # 7 nav links (comps, stats, items, search, feed, players, explore)
        │   ├── ServerSelector.tsx    # PBE/Live toggle (swaps URL server segment)
        │   ├── StatsBar.tsx          # Matches analyzed, participants, last fetch time
        │   ├── FreshnessGuard.tsx    # Polls data-version, auto-reloads on change (60s cooldown)
        │   ├── TftImage.tsx          # UnitImage + ItemImage with CDragon URLs and fallbacks
        │   ├── StatsTable.tsx        # Sortable unit stats table with expandable star/item details
        │   ├── CompsList.tsx         # Comp cards with flex combos, tiers (S/A/B/C/D), explore button
        │   ├── WinningCompsList.tsx  # 1st-place matches with trait viz, expandable lobby
        │   ├── DataExplorer.tsx      # Advanced boolean filters (units/traits/items/levels)
        │   ├── ItemsExplorer.tsx     # Per-unit item analysis with delta from baseline
        │   ├── SearchComps.tsx       # Search matches by unit(s) with lobby expansion
        │   ├── PlayerProfile.tsx     # Player detail: stats, top units, last 20, match history
        │   └── PlayerStatsList.tsx   # Player rankings with sortable columns
        └── [server]/                 # Dynamic segment: "pbe" or "live"
            ├── layout.tsx            # Validates server param (404 if invalid)
            ├── page.tsx              # Redirects to /{server}/comps
            ├── comps/page.tsx        # Curated compositions
            ├── comps/hidden/page.tsx # Auto-discovered compositions
            ├── unit-stats/page.tsx
            ├── items/page.tsx
            ├── search/page.tsx
            ├── games-feed/page.tsx
            ├── explore/page.tsx
            ├── players/page.tsx
            └── player/[name]/page.tsx
```

## Models

| Model | Key fields | Notes |
|---|---|---|
| Player | game_name, tag_line, puuid (unique), **region** (default="PBE"), last_seen_match_id, last_polled_at | unique_together: (game_name, tag_line, region) |
| Match | match_id (PK), game_datetime, game_version, **server** (PBE/LIVE), raw_json, created_at | server field indexed |
| Participant | FK Match (CASCADE) + FK Player (nullable, SET_NULL), puuid, placement, level, gold_left | unique_together: (match, puuid) |
| Unit | character_id (unique), cost, traits (JSONField) | Immutable metadata from CDragon |
| UnitUsage | FK Participant (CASCADE) + FK Unit (CASCADE), star_level, rarity, items (JSONField) | Bulk-created per match |
| AggregatedUnitStat | FK Unit (CASCADE), **server** (PBE/LIVE), games, total_placement, avg_placement, top4_rate, win_rate | unique_together: (unit, server) |
| Comp | name, **server** (PBE/LIVE), units, target_level, excluded_units, excluded_unit_counts, required_traits, required_unit_counts, required_unit_star_levels, required_unit_item_counts, required_trait_breakpoints, excluded_traits, is_active | unique_together: (name, server) |

**Cascade:** Match → Participant → UnitUsage

## PBE vs LIVE — Key Differences

| Aspect | PBE | LIVE |
|---|---|---|
| Players | ~285, region="PBE" | ~45, region=NA1/KR/EUW1/LAS etc. |
| API routing | Always `americas` | Per-platform: americas/europe/asia/sea |
| Min tracked players/match | 6 of 8 | 1 of 8 |
| Untracked participants | Auto-create Player | Store with player=NULL |
| Stats filtering | All participants | Only `player__isnull=False` |
| Game version | Hardcoded (e.g., "16.6 D") | Extracted from API (minor+1) |
| Date filter | Configurable cutoff datetime | Min game version filter |
| Fetch command | `fetch_pbe` | `fetch_live` |
| Player init command | `fetch_puuid` | `fetch_live_puuid` |

## REST API

**Base path:** `/api/`
**All endpoints accept `server=PBE|LIVE` (default: PBE)**

| Endpoint | Method | Purpose | Key Params |
|---|---|---|---|
| `/data-version/` | GET | Match count for cache busting | — |
| `/stats/` | GET | Global stats (matches, players, last fetch) | game_version |
| `/unit-stats/` | GET | Unit statistics | sort, min_games, search, game_version |
| `/unit-stats/<name>/star-stats/` | GET | Star level + top 6 items for a unit | game_version |
| `/item-stats/` | GET | Per-unit item stats with delta | unit (required), game_version, min_games, selected_item |
| `/explore/` | GET | Advanced boolean filtering | require_unit, ban_unit, require_trait, require_trait_tier, require_trait_max_tier, exclude_trait, require_item_on_unit, require_item, exclude_item, require_unit_count, exclude_unit_count, require_unit_star, require_unit_item_count, player_level, include_trait_stats, game_version |
| `/comps/` | GET | Curated comp stats with flex combos | game_version, limit, top_flex |
| `/comps/hidden/` | GET | Auto-discovered core comps | game_version, limit, core_sizes, min_occurrences, target_level, top_flex |
| `/winning-comps/` | GET | Best placements per match | limit, game_version |
| `/search-comps/` | GET | Search by required units | unit (repeatable), game_version, limit, sort |
| `/versions/` | GET | Distinct game versions | — |
| `/traits/` | GET | Trait breakpoints + CDragon icons | — |
| `/champions/` | GET | All Set 16 champions from CDragon | — |
| `/item-assets/` | GET | Item ID → URL + name mappings | — |
| `/match/<id>/lobby` | GET | Full 8-player match lobby | — |
| `/player/<name>/profile/` | GET | Player stats + 50-game history | game_version |
| `/players/` | GET | All tracked players | — |
| `/player-stats/` | GET | Player rankings | sort, search, min_games |

## Frontend routing

All pages live under `/{server}/` where server is `pbe` or `live`.
Middleware redirects bare paths (e.g., `/comps` → `/pbe/comps`).

| Route | Description |
|---|---|
| `/` | Landing page — hero, quick stats, features grid |
| `/{server}/comps` | Curated compositions with flex combos |
| `/{server}/comps/hidden` | Auto-discovered core compositions |
| `/{server}/unit-stats` | Unit statistics with sorting/filtering |
| `/{server}/items` | Item explorer — per-unit item analysis |
| `/{server}/search` | Search matches by unit(s) |
| `/{server}/games-feed` | Recent match feed (best placements) |
| `/{server}/players` | Player rankings |
| `/{server}/player/[name]` | Individual player profile |
| `/{server}/explore` | Advanced data explorer (boolean filters) |

## Frontend data fetching

- **Server components** fetch with `cache: "no-store"` and ISR via `fetchApi()` helper
- **ISR cache busting**: `getDataVersion()` fetches match count (30s TTL), appended as `_v` param
- **Client components** (`"use client"`) fetch with `useEffect`, pass `?server=PBE|LIVE`
- **Backend URL**: dev → `http://localhost:8000`, prod → `https://project-pbe-production.up.railway.app`
- **FreshnessGuard**: polls `/api/freshness`, auto-reloads page on data version change (60s cooldown)
- **Infinite scroll**: most list components load 10 items at a time via IntersectionObserver

## Riot API client (`riot_api.py`)

- **RiotAPIService** class with region-aware routing
- **Region mapping**: PBE/NA→americas, EUW/EUNE/TR/RU→europe, KR/JP→asia, OCE/SEA→sea
- `asyncio.Semaphore(5)` — max 5 concurrent in-flight requests
- Exponential backoff on 429 (uses `Retry-After` header), max 6 retries
- Returns `None` on 404 or exhausted retries
- Methods: `get_account()`, `get_match_ids()`, `get_match()`

## Async / ORM boundary — CRITICAL

Django ORM must **never** be called from async context.
- `handle()` is fully synchronous
- `asyncio.run()` only for pure HTTP helpers (`_fetch_*_async`)
- All DB reads/writes in sync methods

## Management commands

### Player initialization
```bash
python manage.py fetch_puuid          # PBE: ~285 players → Player(region="PBE")
python manage.py fetch_live_puuid     # LIVE: ~45 players → Player(region=NA1/KR/EUW1/etc.)
```

### Match fetching
```bash
python manage.py fetch_pbe                        # PBE: all players
python manage.py fetch_pbe --player DarthNub      # single player
python manage.py fetch_pbe --match PBE1_452503    # force-store a match

python manage.py fetch_live                       # LIVE: all regions
python manage.py fetch_live --player Faker         # single player
python manage.py fetch_live --region KR            # single region
python manage.py fetch_live --match NA1_12345      # force-store

python manage.py fetch_pbe_loop --interval 250    # continuous PBE daemon
```

### Composition management
```bash
python manage.py upsert_comp --name "Kalista Carry" --units "Kaisa*2,ChoGath,KogMaw" \
  --level 9 --require-traits "Sniper:2" --require-items "Kaisa:3" --server PBE

python manage.py suggest_comps --top 10 --game-version "16.6"
python manage.py top_comps --core 5 --sort avg_placement
python manage.py delete_comp --name "Old Comp"
```

### Data maintenance
```bash
python manage.py update_unit_stats                 # recompute AggregatedUnitStat
python manage.py fetch_item_data                   # CDragon → item_assets.json + item_names.json
python manage.py fetch_unit_data                   # CDragon → Unit model
python manage.py delete_matches_before_cutoff      # cleanup old data (cascades)
python manage.py fix_pbe_game_version              # fix version labels by switchover datetime
python manage.py convert_game_version              # rename version labels
```

## Key architectural patterns

### Composition analysis
- **Curated comps** (`Comp` model): manually defined via `upsert_comp` with constraints (required/excluded units, traits, star levels, item counts, trait breakpoints)
- **Hidden comps** (auto-discovered): generates all unit combinations of sizes 4-6, filters by frequency, ranks flex combos
- **Weighted slots**: Atakhan/Galio = 0 slots, Baron = 2 slots, others = 1
- **Comp tiers** (frontend): S (<3.7 AVP), A (<4.0), B (<4.4), C (<4.8), D (5.0+)

### Item canonicalization
- Maps duplicate item IDs (Corrupted variants, etc.) to a single canonical ID by display name
- Applied before all aggregation/filtering

### Caching strategy
- **Backend in-memory**: trait/champion data (1h TTL), item assets (persistent), versions/players/comps/explore (version-based invalidation on match count)
- **HTTP Cache-Control**: 30s (data-version) to 300s (most endpoints)
- **Frontend**: ISR with data-version cache busting, FreshnessGuard auto-reload

### Trait visualization (frontend)
- Traits computed from unit data using CDragon breakpoints
- Color-coded by tier: unique=red, bronze=amber, silver=slate, gold=yellow, chromatic=violet
- Shows breakpoint progress (e.g., "3/4")

## Tailwind TFT theme

```
tft-bg: #0a0e1a       tft-surface: #111827    tft-border: #1f2a40
tft-accent: #c89b3c   tft-gold: #f0b429       tft-text: #e2e8f0
tft-muted: #64748b     tft-hover: #1e2d4a
```

**Cost border colors**: 1=gray, 2=green, 3=blue, 4=purple, 5/7=yellow

## Player lists

| List | File | Count | Format | Region |
|---|---|---|---|---|
| PBE | `fetch_puuid.py` → `_RAW_PLAYER_LIST` | ~285 | `GameName#TagLine` (default tag: `pbe`) | "PBE" |
| LIVE | `fetch_live_puuid.py` → `_RAW_PLAYER_LIST` | ~45 | `GameName#TagLine:REGION` (default: NA1) | NA1/KR/EUW1/LAS |

Unicode directional chars (`U+2066`, `U+2069`, `U+200B`, etc.) stripped automatically. Deduplication is case-insensitive.

## Deployment

- **Backend:** Railway (Gunicorn, 4 workers, 4 threads, auto-migrate on deploy)
- **Frontend:** Vercel or Railway
- **Database:** PostgreSQL on Railway (production), SQLite (local)

**Procfile:**
```
web: cd backend && python manage.py migrate --noinput && gunicorn tft_tracker.wsgi --bind 0.0.0.0:$PORT --workers 4 --threads 4 --timeout 60
```

## Environment variables

### Backend (`.env`)
```
RIOT_API_KEY=RGAPI-...
SECRET_KEY=...
DEBUG=True
DATABASE_URL=                          # blank = SQLite; postgresql://... for Postgres
ALLOWED_HOSTS=localhost,127.0.0.1,*.railway.app
PBE_QUEUE_CUTOFF_DATE=2026-02-23       # Match cutoff for fetch_pbe + delete_matches
PBE_QUEUE_CUTOFF_TIME=00:00
PBE_QUEUE_CUTOFF_TZ=America/Cuiaba
FETCH_PBE_PLAYER_COOLDOWN_SECONDS=0
LIVE_MIN_GAME_VERSION=16.5             # Skip LIVE matches older than this patch
```

### Frontend
```
NODE_ENV=development|production
BACKEND_URL=http://localhost:8000       # dev override
NEXT_PUBLIC_BACKEND_URL=...             # public override
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
