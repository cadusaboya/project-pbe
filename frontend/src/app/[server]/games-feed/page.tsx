import WinningCompsList, { TraitInfo, WinningComp } from "../../components/WinningCompsList";
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
  let data: WinningComp[] = [];
  let itemAssets: Record<string, string> = {};
  let itemNames: Record<string, string> = {};
  let versions: string[] = [];
  let error: string | null = null;

  let traitBreakpoints: Record<string, TraitInfo> = {};
  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [data, itemData, versions, traitBreakpoints] = await Promise.all([
      fetchWinningComps(gameVersion, server),
      fetchItemData(),
      fetchVersions(server),
      fetchTraitBreakpoints(),
    ]);
    itemAssets = itemData.assets;
    itemNames = itemData.names;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Games Feed</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Matches tracked, sorted by most recent. Click to see the full lobby.
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
          server={server}
        />
      )}
    </div>
  );
}
