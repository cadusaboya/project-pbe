import CompsList, { CompStat } from "../components/CompsList";
import { backendUrl } from "@/lib/backend";

async function fetchCompStats(gameVersion?: string): Promise<CompStat[]> {
  const url = new URL(backendUrl("/api/comps/"));
  if (gameVersion) url.searchParams.set("game_version", gameVersion);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch composition stats: ${res.status}`);
  }
  return res.json();
}

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch(backendUrl("/api/versions/"), { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function CompsPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;
  let data: CompStat[] = [];
  let versions: string[] = [];
  let error: string | null = null;

  try {
    [data, versions] = await Promise.all([
      fetchCompStats(gameVersion),
      fetchVersions(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Compositions</h1>
        <p className="text-tft-muted text-sm mt-1">
          Curated from project PBE. Click to view the 3 most common flex combos and AVP.
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
          No comps created.
        </div>
      ) : (
        <CompsList
          data={data}
          versions={versions}
          selectedVersion={gameVersion ?? ""}
          basePath="/comps"
          showCompMeta={false}
        />
      )}
    </div>
  );
}
