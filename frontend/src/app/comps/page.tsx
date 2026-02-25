import CompsList, { CompStat } from "../components/CompsList";
import { getDataVersion, fetchApi } from "@/lib/api";

interface CompsResponse {
  total_games: number;
  comps: CompStat[];
}

async function fetchCompStats(dv: number, gameVersion?: string): Promise<CompsResponse> {
  const path = gameVersion
    ? `/api/comps/?game_version=${encodeURIComponent(gameVersion)}`
    : "/api/comps/";
  const res = await fetchApi(path, { revalidate: 60 }, dv);
  if (!res.ok) throw new Error(`Failed to fetch composition stats: ${res.status}`);
  return res.json();
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

async function fetchTraits(dv: number): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    const res = await fetchApi("/api/traits/", { revalidate: 60 }, dv);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function CompsPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;
  const dv = await getDataVersion();
  let data: CompStat[] = [];
  let totalGames = 0;
  let versions: string[] = [];
  let traitData: Record<string, { breakpoints: number[]; icon: string }> = {};
  let error: string | null = null;

  try {
    const [compsRes, v, t] = await Promise.all([
      fetchCompStats(dv, gameVersion),
      fetchVersions(dv),
      fetchTraits(dv),
    ]);
    data = compsRes.comps;
    totalGames = compsRes.total_games;
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
          basePath="/comps"
          showCompMeta={false}
          traitData={traitData}
          totalGames={totalGames}
        />
      )}
    </div>
  );
}
