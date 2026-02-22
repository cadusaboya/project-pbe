"""
fetch_unit_data.py

Downloads TFT champion data from Community Dragon (PBE) and updates
each Unit in the database with its shop cost and trait list.

Source: https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json
Structure used: data["sets"]["16"]["champions"] → [{apiName, cost, traits}]

Usage:
    python manage.py fetch_unit_data
"""

import httpx
from django.core.management.base import BaseCommand

from tracker.models import Unit

CDRAGON_URL = (
    "https://raw.communitydragon.org/pbe/cdragon/tft/en_us.json"
)


class Command(BaseCommand):
    help = "Fetch unit cost and traits from Community Dragon and update the Unit table."

    def handle(self, *args, **options):
        self.stdout.write("Downloading TFT data from Community Dragon (may take ~30s)…")

        with httpx.Client(timeout=120) as client:
            resp = client.get(CDRAGON_URL)
            resp.raise_for_status()
            data = resp.json()

        # Build lookup: apiName → {cost, traits} from every set entry.
        # Later sets overwrite earlier ones for the same apiName, which is fine.
        champion_lookup: dict[str, dict] = {}
        sets = data.get("sets", {})
        if not sets:
            self.stderr.write("No 'sets' key found in CDragon response. Aborting.")
            return

        for set_key, set_entry in sets.items():
            for champ in set_entry.get("champions", []):
                api_name: str = champ.get("apiName", "")
                if not api_name:
                    continue
                champion_lookup[api_name] = {
                    "cost": champ.get("cost", 0),
                    "traits": champ.get("traits", []),
                }

        self.stdout.write(f"Found data for {len(champion_lookup)} champions.")

        units = list(Unit.objects.all())
        updated, not_found = 0, []

        for unit in units:
            entry = champion_lookup.get(unit.character_id)
            if entry:
                unit.cost = entry["cost"]
                unit.traits = entry["traits"]
                unit.save(update_fields=["cost", "traits"])
                self.stdout.write(
                    f"  {unit.character_id}: cost={unit.cost}, traits={unit.traits}"
                )
                updated += 1
            else:
                not_found.append(unit.character_id)

        self.stdout.write(
            self.style.SUCCESS(f"\nUpdated {updated}/{len(units)} units.")
        )
        if not_found:
            self.stdout.write(
                self.style.WARNING(f"Not found in CDragon: {', '.join(not_found)}")
            )
