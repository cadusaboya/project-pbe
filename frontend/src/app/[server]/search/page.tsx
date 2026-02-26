import { Suspense } from "react";
import SearchComps from "../../components/SearchComps";
import { fetchJson } from "@/lib/api";
import { UnitStat } from "../../components/StatsTable";
import { TraitInfo } from "../../components/WinningCompsList";

async function fetchTraitBreakpoints(): Promise<Record<string, TraitInfo>> {
  try {
    return await fetchJson<Record<string, TraitInfo>>("/api/traits/");
  } catch {
    return {};
  }
}

async function fetchItemData(): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    return await fetchJson<{ assets: Record<string, string>; names: Record<string, string> }>("/api/item-assets/");
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchUnits(server?: string): Promise<UnitStat[]> {
  try {
    const params = new URLSearchParams({ sort: "games" });
    if (server) params.set("server", server);
    return await fetchJson<UnitStat[]>(`/api/unit-stats/?${params}`);
  } catch {
    return [];
  }
}

export default async function SearchPage({
  params,
}: {
  params: Promise<{ server: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const [units, itemData, traitData] = await Promise.all([
    fetchUnits(server),
    fetchItemData(),
    fetchTraitBreakpoints(),
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
          server={server}
        />
      </Suspense>
    </div>
  );
}
