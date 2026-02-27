import { Suspense } from "react";
import WinningCompsList, { TraitInfo, WinningComp, UnitStatBasic } from "../../components/WinningCompsList";
import PageSkeleton from "../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";

async function fetchTraitBreakpoints(): Promise<Record<string, TraitInfo>> {
  try {
    return await fetchJson<Record<string, TraitInfo>>("/api/traits/");
  } catch {
    return {};
  }
}

async function fetchWinningComps(gameVersion?: string, server?: string): Promise<WinningComp[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (gameVersion) params.set("game_version", gameVersion);
  if (server) params.set("server", server);
  return fetchJson<WinningComp[]>(`/api/winning-comps/?${params}`);
}

async function fetchItemData(): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    return await fetchJson<{ assets: Record<string, string>; names: Record<string, string> }>("/api/item-assets/");
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchVersions(server?: string): Promise<string[]> {
  try {
    const params = new URLSearchParams();
    if (server) params.set("server", server);
    const qs = params.toString();
    return await fetchJson<string[]>(`/api/versions/${qs ? `?${qs}` : ""}`);
  } catch {
    return [];
  }
}

async function fetchAllUnits(server?: string): Promise<UnitStatBasic[]> {
  try {
    const params = new URLSearchParams();
    if (server) params.set("server", server);
    const qs = params.toString();
    // Try lightweight cached champions endpoint first
    const data = await fetchJson<Array<{ apiName: string; cost: number }>>(`/api/champions/${qs ? `?${qs}` : ""}`);
    if (data.length > 0) return data.map((u) => ({ unit_name: u.apiName, cost: u.cost }));
  } catch { /* fall through */ }
  // Fallback: unit-stats (pre-computed, reads from AggregatedUnitStat)
  try {
    const params = new URLSearchParams({ sort: "games" });
    if (server) params.set("server", server);
    const data = await fetchJson<Array<{ unit_name: string; cost: number }>>(`/api/unit-stats/?${params}`);
    return data.map((u) => ({ unit_name: u.unit_name, cost: u.cost }));
  } catch {
    return [];
  }
}

async function FeedContent({
  server,
  gameVersion,
}: {
  server: string;
  gameVersion: string;
}) {
  let data: WinningComp[] = [];
  let itemAssets: Record<string, string> = {};
  let versions: string[] = [];
  let allUnits: UnitStatBasic[] = [];
  let error: string | null = null;
  let traitBreakpoints: Record<string, TraitInfo> = {};

  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [data, itemData, versions, traitBreakpoints, allUnits] = await Promise.all([
      fetchWinningComps(gameVersion, server),
      fetchItemData(),
      fetchVersions(server),
      fetchTraitBreakpoints(),
      fetchAllUnits(server),
    ]);
    itemAssets = itemData.assets;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
        <span className="font-semibold">Error:</span> {error}
        <p className="mt-1 text-red-500/70">
          Make sure the backend is running and reachable.
        </p>
      </div>
    );
  }

  return (
    <WinningCompsList
      data={data}
      itemAssets={itemAssets}
      versions={versions}
      selectedVersion={gameVersion}
      traitData={traitBreakpoints}
      server={server}
      allUnits={allUnits}
    />
  );
}

export default async function GamesFeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { game_version: gameVersion } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Games Feed</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Matches tracked, sorted by most recent. Filter by units to search across all placements.
        </p>
      </div>

      <Suspense fallback={<PageSkeleton variant="feed" />}>
        <FeedContent server={server} gameVersion={gameVersion ?? ""} />
      </Suspense>
    </div>
  );
}
