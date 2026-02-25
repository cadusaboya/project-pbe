import WinningCompsList, { TraitInfo, WinningComp } from "../components/WinningCompsList";
import { getDataVersion, fetchApi } from "@/lib/api";

async function fetchTraitBreakpoints(dv: number): Promise<Record<string, TraitInfo>> {
  try {
    const res = await fetchApi("/api/traits/", { revalidate: 60 }, dv);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchWinningComps(dv: number, gameVersion?: string): Promise<WinningComp[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (gameVersion) params.set("game_version", gameVersion);

  const res = await fetchApi(`/api/winning-comps/?${params}`, { revalidate: 60 }, dv);
  if (!res.ok) throw new Error(`Failed to fetch winning comps: ${res.status}`);
  return res.json();
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

async function fetchVersions(dv: number): Promise<string[]> {
  try {
    const res = await fetchApi("/api/versions/", { revalidate: 60 }, dv);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function GamesFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;
  const dv = await getDataVersion();
  let data: WinningComp[] = [];
  let itemAssets: Record<string, string> = {};
  let versions: string[] = [];
  let error: string | null = null;

  let traitBreakpoints: Record<string, TraitInfo> = {};
  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [data, itemData, versions, traitBreakpoints] = await Promise.all([
      fetchWinningComps(dv, gameVersion),
      fetchItemData(dv),
      fetchVersions(dv),
      fetchTraitBreakpoints(dv),
    ]);
    itemAssets = itemData.assets;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Games Feed</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          PBE matches tracked, sorted by most recent. Click to see the full lobby.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
          <p className="mt-1 text-red-500/70">
            Make sure the backend is running and reachable.
          </p>
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No winning comps yet. Run{" "}
          <code className="font-mono text-tft-accent">
            python manage.py fetch_pbe
          </code>{" "}
          to populate the database.
        </div>
      ) : (
        <WinningCompsList
          data={data}
          itemAssets={itemAssets}
          versions={versions}
          selectedVersion={gameVersion ?? ""}
          traitData={traitBreakpoints}
        />
      )}
    </div>
  );
}
