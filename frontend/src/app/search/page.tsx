import { Suspense } from "react";
import SearchComps from "../components/SearchComps";
import { backendUrl } from "@/lib/backend";
import { UnitStat } from "../components/StatsTable";
import { TraitInfo } from "../components/WinningCompsList";

async function fetchTraitBreakpoints(): Promise<Record<string, TraitInfo>> {
  try {
    const res = await fetch(backendUrl("/api/traits/"), { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchItemData(): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    const res = await fetch(backendUrl("/api/item-assets/"), { cache: "no-store" });
    if (!res.ok) return { assets: {}, names: {} };
    return res.json();
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchUnits(): Promise<UnitStat[]> {
  try {
    const res = await fetch(backendUrl("/api/unit-stats/?sort=games"), { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function SearchPage() {
  const [units, itemData, traitData] = await Promise.all([
    fetchUnits(),
    fetchItemData(),
    fetchTraitBreakpoints(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Unit Search</h1>
        <p className="text-tft-muted text-sm mt-1">
          Search for all recorded comps that contain a specific unit or combination of units, across all placements.
        </p>
      </div>
      <Suspense fallback={null}>
        <SearchComps
          units={units}
          itemAssets={itemData.assets}
          itemNames={itemData.names}
          traitData={traitData}
        />
      </Suspense>
    </div>
  );
}
