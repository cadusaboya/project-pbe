import StatsTable, { UnitStat } from "./components/StatsTable";

async function fetchStats(gameVersion?: string): Promise<UnitStat[]> {
  const url = new URL("http://localhost:8000/api/unit-stats/");
  if (gameVersion) url.searchParams.set("game_version", gameVersion);

  const res = await fetch(url.toString(), { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.status}`);
  }

  return res.json();
}

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch("http://localhost:8000/api/versions/", {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;
  let data: UnitStat[] = [];
  let versions: string[] = [];
  let error: string | null = null;

  try {
    [data, versions] = await Promise.all([
      fetchStats(gameVersion),
      fetchVersions(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Unit Statistics</h1>
        <p className="text-tft-muted text-sm mt-1">
          Aggregated data from tracked PBE matches. Click column headers to sort.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
          <p className="mt-1 text-red-500/70">
            Make sure the Django backend is running on port 8000.
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
        />
      )}
    </div>
  );
}
