"""
fetch_item_data.py

Downloads TFT item data from Community Dragon (PBE) and saves a
{item_id → image_url} mapping to backend/item_assets.json.

The CDragon en_us.json contains every item's "apiName" and "icon" path.
We convert the icon path like:
  ASSETS/Maps/Particles/TFT/Item_Icons/Standard/NashorsTooth_XL.png
to:
  https://raw.communitydragon.org/pbe/game/assets/maps/particles/tft/item_icons/standard/nashorstooth_xl.png

Usage:
    python manage.py fetch_item_data
"""

import json
from pathlib import Path

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand

CDRAGON_URL = "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json"
CDRAGON_BASE = "https://raw.communitydragon.org/pbe/game"
OUTPUT_FILE = Path(settings.BASE_DIR) / "item_assets.json"
NAMES_FILE = Path(settings.BASE_DIR) / "item_names.json"


def icon_to_url(icon_path: str) -> str:
    """Convert CDragon icon path to a raw URL."""
    # "ASSETS/Maps/Particles/TFT/Item_Icons/Standard/NashorsTooth_XL.png"
    # → "https://raw.communitydragon.org/pbe/game/assets/maps/.../nashorstooth_xl.png"
    relative = icon_path.replace("ASSETS/", "assets/", 1)
    url = f"{CDRAGON_BASE}/{relative.lower()}"
    # CDragon serves .tex files as .png — swap the extension so browsers can load them
    if url.endswith(".tex"):
        url = url[:-4] + ".png"
    return url


class Command(BaseCommand):
    help = "Fetch TFT item image URLs from Community Dragon and save to item_assets.json."

    def handle(self, *args, **options):
        self.stdout.write("Downloading TFT data from Community Dragon (~22 MB, may take ~30s)…")

        with httpx.Client(timeout=120) as client:
            resp = client.get(CDRAGON_URL)
            resp.raise_for_status()
            data = resp.json()

        items: list[dict] = data.get("items", [])
        if not items:
            self.stderr.write("No 'items' key found in CDragon response. Aborting.")
            return

        self.stdout.write(f"Found {len(items)} items in CDragon data.")

        mapping: dict[str, str] = {}
        names: dict[str, str] = {}
        for item in items:
            api_name: str = item.get("apiName", "")
            icon: str = item.get("icon", "")
            name: str = item.get("name", "")
            if api_name and icon:
                mapping[api_name] = icon_to_url(icon)
            if api_name and name:
                names[api_name] = name

        OUTPUT_FILE.write_text(json.dumps(mapping, indent=2), encoding="utf-8")
        NAMES_FILE.write_text(json.dumps(names, indent=2), encoding="utf-8")
        self.stdout.write(
            self.style.SUCCESS(
                f"Saved {len(mapping)} item assets + {len(names)} item names"
            )
        )
