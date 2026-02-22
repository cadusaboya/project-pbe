import WinningCompsList, { TraitInfo, WinningComp } from "../components/WinningCompsList";
import { backendUrl } from "@/lib/backend";

async function fetchTraitBreakpoints(): Promise<Record<string, TraitInfo>> {
  try {
    const res = await fetch(backendUrl("/api/traits/"), { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchWinningComps(gameVersion?: string): Promise<WinningComp[]> {
  const url = new URL(backendUrl("/api/winning-comps/"));
  url.searchParams.set("limit", "200");
  if (gameVersion) url.searchParams.set("game_version", gameVersion);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch winning comps: ${res.status}`);
  return res.json();
}

async function fetchItemAssets(): Promise<Record<string, string>> {
  try {
    const res = await fetch(backendUrl("/api/item-assets/"), {
      cache: "no-store",
    });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch(backendUrl("/api/versions/"), {
      cache: "no-store",
    });
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
  let data: WinningComp[] = [];
  let itemAssets: Record<string, string> = {};
  let versions: string[] = [];
  let error: string | null = null;

  let traitBreakpoints: Record<string, TraitInfo> = {};
  try {
    [data, itemAssets, versions, traitBreakpoints] = await Promise.all([
      fetchWinningComps(gameVersion),
      fetchItemAssets(),
      fetchVersions(),
      fetchTraitBreakpoints(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Games Feed</h1>
        <p className="text-tft-muted text-sm mt-1">
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
