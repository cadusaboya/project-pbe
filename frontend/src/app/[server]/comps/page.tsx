import CompsList, { CompStat } from "../../components/CompsList";
import { backendUrl } from "@/lib/backend";

interface CompsResponse {
  total_games: number;
  total_comps: number;
  comps: CompStat[];
}

async function fetchCompStats(gameVersion?: string, server?: string): Promise<CompsResponse> {
  const url = new URL(backendUrl("/api/comps/"));
  if (gameVersion) url.searchParams.set("game_version", gameVersion);
  if (server) url.searchParams.set("server", server);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch composition stats: ${res.status}`);
  }
  return res.json();
}

async function fetchVersions(server?: string): Promise<string[]> {
  try {
    const url = new URL(backendUrl("/api/versions/"));
    if (server) url.searchParams.set("server", server);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchTraits(): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    const res = await fetch(backendUrl("/api/traits/"), { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function CompsPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { game_version: gameVersion } = await searchParams;
  let data: CompStat[] = [];
  let totalComps = 0;
  let versions: string[] = [];
  let traitData: Record<string, { breakpoints: number[]; icon: string }> = {};
  let error: string | null = null;

  try {
    const [compsRes, v, t] = await Promise.all([
      fetchCompStats(gameVersion, server),
      fetchVersions(server),
      fetchTraits(),
    ]);
    data = compsRes.comps ?? [];
    totalComps = compsRes.total_comps ?? 0;
    versions = v;
    traitData = t;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Compositions</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
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
          basePath={`/${serverSlug}/comps`}
          showCompMeta={false}
          traitData={traitData}
          totalComps={totalComps}
          server={server}
        />
      )}
    </div>
  );
}
