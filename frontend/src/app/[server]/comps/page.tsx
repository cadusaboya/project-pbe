import CompsList, { CompStat } from "../../components/CompsList";
import { fetchJson } from "@/lib/api";

interface CompsResponse {
  total_games: number;
  total_comps: number;
  comps: CompStat[];
}

async function fetchCompStats(gameVersion?: string, server?: string): Promise<CompsResponse> {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_version", gameVersion);
  if (server) params.set("server", server);
  const qs = params.toString();
  return fetchJson<CompsResponse>(`/api/comps/${qs ? `?${qs}` : ""}`);
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

async function fetchTraits(): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    return await fetchJson<Record<string, { breakpoints: number[]; icon: string }>>("/api/traits/");
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
          Curated comps, click to view the 3 most common flex combos and AVP. Click on Explore for a full grasp on how to optimize the comp.
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
