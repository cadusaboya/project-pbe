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

async function fetchItemAssets(): Promise<Record<string, string>> {
  try {
    const res = await fetch(backendUrl("/api/item-assets/"), { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
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
  const [units, itemAssets, traitData] = await Promise.all([
    fetchUnits(),
    fetchItemAssets(),
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
          itemAssets={itemAssets}
          traitData={traitData}
        />
      </Suspense>
    </div>
  );
}
