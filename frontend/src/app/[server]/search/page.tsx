import { Suspense } from "react";
import SearchComps from "../../components/SearchComps";
import PageSkeleton from "../../components/PageSkeleton";
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

async function fetchUnits(server?: string, tier?: string, queue?: string): Promise<UnitStat[]> {
  try {
    const params = new URLSearchParams({ sort: "games" });
    if (server) params.set("server", server);
    if (tier) params.set("tier", tier);
    if (queue) params.set("queue", queue);
    return await fetchJson<UnitStat[]>(`/api/unit-stats/?${params}`);
  } catch {
    return [];
  }
}

async function SearchContent({ server, tier, queue }: { server: string; tier?: string; queue?: string }) {
  const [units, itemData, traitData] = await Promise.all([
    fetchUnits(server, tier, queue),
    fetchItemData(),
    fetchTraitBreakpoints(),
  ]);

  return (
    <SearchComps
      units={units}
      itemAssets={itemData.assets}
      itemNames={itemData.names}
      traitData={traitData}
      server={server}
      tier={tier}
      queue={queue}
    />
  );
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string; tier?: string; queue?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { tier, queue } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Unit Search</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Search for all recorded comps that contain a specific unit or combination of units, across all placements.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton variant="explorer" />}>
        <SearchContent server={server} tier={tier} queue={queue} />
      </Suspense>
    </div>
  );
}
