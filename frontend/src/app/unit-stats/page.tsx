import StatsTable, { UnitStat } from "../components/StatsTable";
import { getDataVersion, fetchApi } from "@/lib/api";

async function fetchStats(dv: number, gameVersion?: string): Promise<UnitStat[]> {
  const path = gameVersion
    ? `/api/unit-stats/?game_version=${encodeURIComponent(gameVersion)}`
    : "/api/unit-stats/";
  const res = await fetchApi(path, { revalidate: 60 }, dv);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
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

async function fetchMatchesAnalyzed(dv: number, gameVersion?: string): Promise<number> {
  try {
    const path = gameVersion
      ? `/api/stats/?game_version=${encodeURIComponent(gameVersion)}`
      : "/api/stats/";
    const res = await fetchApi(path, { revalidate: 60 }, dv);
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.matches_analyzed ?? 0);
  } catch {
    return 0;
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;
  const dv = await getDataVersion();
  let data: UnitStat[] = [];
  let versions: string[] = [];
  let matchesAnalyzed = 0;
  let error: string | null = null;

  try {
    [data, versions, matchesAnalyzed] = await Promise.all([
      fetchStats(dv, gameVersion),
      fetchVersions(dv),
      fetchMatchesAnalyzed(dv, gameVersion),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Unit Statistics</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Aggregated data from tracked PBE matches. Click column headers to sort.
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
          No data yet. Run{" "}
          <code className="font-mono text-tft-accent">
            python manage.py fetch_pbe
          </code>{" "}
          to populate the database.
        </div>
      ) : (
        <StatsTable
          data={data}
          versions={versions}
          selectedVersion={gameVersion ?? ""}
          matchesAnalyzed={matchesAnalyzed}
          dataVersion={dv}
        />
      )}
    </div>
  );
}
