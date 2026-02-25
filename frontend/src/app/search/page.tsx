import { Suspense } from "react";
import SearchComps from "../components/SearchComps";
import { getDataVersion, fetchApi } from "@/lib/api";
import { UnitStat } from "../components/StatsTable";
import { TraitInfo } from "../components/WinningCompsList";

async function fetchTraitBreakpoints(dv: number): Promise<Record<string, TraitInfo>> {
  try {
    const res = await fetchApi("/api/traits/", { revalidate: 60 }, dv);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchItemData(dv: number): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    const res = await fetchApi("/api/item-assets/", { revalidate: 60 }, dv);
    if (!res.ok) return { assets: {}, names: {} };
    return res.json();
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchUnits(dv: number): Promise<UnitStat[]> {
  try {
    const res = await fetchApi("/api/unit-stats/?sort=games", { revalidate: 60 }, dv);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function SearchPage() {
  const dv = await getDataVersion();
  const [units, itemData, traitData] = await Promise.all([
    fetchUnits(dv),
    fetchItemData(dv),
    fetchTraitBreakpoints(dv),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Unit Search</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Search for all recorded comps that contain a specific unit or combination of units, across all placements.
        </p>
      </div>
      <Suspense fallback={null}>
        <SearchComps
          units={units}
          itemAssets={itemData.assets}
          itemNames={itemData.names}
          traitData={traitData}
          dataVersion={dv}
        />
      </Suspense>
    </div>
  );
}
