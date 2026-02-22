# TFT PBE Match Tracker — Backend

Django 5 + Django REST Framework backend that fetches TFT PBE matches for a
fixed set of Riot IDs, stores participants and units, and exposes aggregated
per-unit statistics through a REST API.

---

## Tech stack

| Layer | Technology |
|---|---|
| Web framework | Django 5, Django REST Framework |
| Database | SQLite (dev default) / PostgreSQL |
| Async HTTP | httpx (async client) |
| Task runner | Django management command (no Celery / Redis) |

---

## Quick start

### 1. Prerequisites

- Python 3.12+
- pip (or any pip-compatible installer)

### 2. Create a virtual environment

```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set:

| Variable | Description |
|---|---|
| `RIOT_API_KEY` | Your Riot API key from https://developer.riotgames.com |
| `SECRET_KEY` | Django secret key (see below) |
| `DEBUG` | `True` for development, `False` for production |
| `DATABASE_URL` | Leave blank for SQLite; set a PostgreSQL URL for Postgres |

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

### 5. Apply database migrations

```bash
python manage.py migrate
```

### 6. (Optional) Create a Django admin superuser

```bash
python manage.py createsuperuser
```

### 7. Fetch PBE matches

```bash
python manage.py fetch_pbe
```

This command:
1. Resolves all ~140 hardcoded Riot IDs → PUUIDs (stored in `Player` table)
2. Fetches the last 20 match IDs per player
3. Deduplicates match IDs across all players
4. Stores only matches not yet in the database
5. Stores `Participant` and `UnitUsage` rows for every tracked player
6. Recomputes `AggregatedUnitStat` for every unit seen

Run it periodically to keep the data fresh.

### 8. Start the development server

```bash
python manage.py runserver
```

---

## API reference

### `GET /api/unit-stats/`

Returns aggregated unit statistics sorted by average placement (ascending)
by default.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | string | `avg_placement` | Sort field: `avg_placement`, `games`, `win_rate`, `top4_rate` |
| `min_games` | integer | — | Exclude units with fewer games than this threshold |
| `search` | string | — | Case-insensitive substring filter on `character_id` |

**Example request**

```
GET /api/unit-stats/?sort=win_rate&min_games=10&search=Ahri
```

**Example response**

```json
[
  {
    "unit_name": "TFT12_Ahri",
    "games": 120,
    "avg_placement": 3.41,
    "top4_rate": 0.63,
    "win_rate": 0.17
  }
]
```

---

## PostgreSQL setup (optional)

```sql
CREATE DATABASE tft_tracker;
CREATE USER tft_user WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE tft_tracker TO tft_user;
```

Then set in `.env`:

```
DATABASE_URL=postgresql://tft_user:yourpassword@localhost:5432/tft_tracker
```

Run migrations again after switching:

```bash
python manage.py migrate
```

---

## Project layout

```
backend/
├── manage.py
├── requirements.txt
├── .env.example
├── tft_tracker/              # Django project package
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
└── tracker/                  # Main application
    ├── models.py             # Player, Match, Participant, Unit, UnitUsage, AggregatedUnitStat
    ├── serializers.py        # DRF serializer for the API response
    ├── views.py              # UnitStatsView (ListAPIView)
    ├── urls.py
    ├── admin.py
    ├── services/
    │   ├── riot_api.py       # Async Riot API client (semaphore + retry)
    │   ├── aggregation.py    # recompute_unit_stats()
    │   └── match_processor.py# process_match() — parse & persist
    ├── management/
    │   └── commands/
    │       └── fetch_pbe.py  # python manage.py fetch_pbe
    └── migrations/
        └── 0001_initial.py
```

---

## Notes on the player list

- Entries **without** a `#` (e.g. `Lab 003 Broseph`) are sent to the API with
  an empty tag line. They will almost certainly return 404 and be skipped with
  a warning logged to the console.
- Unicode directional-isolation markers (`U+2066` / `U+2069`) are stripped
  automatically before API calls.
- Duplicate entries (case-insensitive) are deduplicated before any API call is
  made, so no player is ever fetched twice in one run.
