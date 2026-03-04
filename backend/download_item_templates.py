"""
Download standard TFT item icons from CDragon for template matching.
Only downloads equippable items (TFT_Item_*), not augments.

Usage:
    python download_item_templates.py
"""
import json
import urllib.request
from pathlib import Path

CDRAGON_URL = "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json"
CDRAGON_BASE = "https://raw.communitydragon.org/pbe/game"
OUTPUT_DIR = Path(__file__).parent / "item_templates"
NAMES_OUTPUT = Path(__file__).parent / "item_names_ocr.json"

HEADERS = {"User-Agent": "Mozilla/5.0"}


def icon_to_url(icon_path: str) -> str:
    relative = icon_path.replace("ASSETS/", "assets/", 1)
    url = f"{CDRAGON_BASE}/{relative.lower()}"
    if url.endswith(".tex"):
        url = url[:-4] + ".png"
    return url


def main():
    print("Downloading CDragon TFT data (~22 MB)...")
    req = urllib.request.Request(CDRAGON_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())

    items = data.get("items", [])
    print(f"Total items in CDragon: {len(items)}")

    # Filter to equippable items
    equippable = []
    for item in items:
        api_name = item.get("apiName", "") or ""
        icon = item.get("icon", "") or ""
        # Standard items: TFT_Item_* (components, completed, radiant, artifact, etc.)
        if api_name.startswith("TFT_Item_"):
            equippable.append(item)
        # Darkin weapons (Set 16): TFT16_TheDarkin*
        elif api_name.startswith("TFT16_TheDarkin"):
            equippable.append(item)
        # Bilgewater equippable items (Set 16)
        elif api_name.startswith("TFT16_Item_Bilgewater_"):
            equippable.append(item)

    print(f"Equippable items: {len(equippable)}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    names = {}
    downloaded = 0
    skipped = 0

    for item in equippable:
        api_name = item["apiName"]
        icon = item.get("icon", "")
        name = item.get("name", api_name)

        if not icon:
            continue

        url = icon_to_url(icon)
        out_path = OUTPUT_DIR / f"{api_name}.png"

        if out_path.exists():
            skipped += 1
            names[api_name] = name
            continue

        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                out_path.write_bytes(resp.read())
            names[api_name] = name
            downloaded += 1
            if downloaded % 20 == 0:
                print(f"  Downloaded {downloaded}...")
        except Exception as e:
            print(f"  FAILED {api_name}: {e}")

    NAMES_OUTPUT.write_text(json.dumps(names, indent=2), encoding="utf-8")
    print(f"\nDone: {downloaded} downloaded, {skipped} skipped (already exist)")
    print(f"Saved {len(names)} item names to {NAMES_OUTPUT.name}")


if __name__ == "__main__":
    main()
