import { Suspense } from "react";
import StatsTable, { UnitStat } from "../../components/StatsTable";
import PageSkeleton from "../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";
import { DEFAULT_GAME_VERSION } from "@/lib/constants";

async function fetchStats(gameVersion?: string, server?: string): Promise<UnitStat[]> {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_version", gameVersion);
  if (server) params.set("server", server);
  const qs = params.toString();
  return fetchJson<UnitStat[]>(`/api/unit-stats/${qs ? `?${qs}` : ""}`);
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

async function StatsContent({
  server,
  gameVersion,
}: {
  server: string;
  gameVersion: string;
}) {
  let data: UnitStat[] = [];
  let versions: string[] = [];
  let error: string | null = null;

  try {
    [data, versions] = await Promise.all([
      fetchStats(gameVersion, server),
      fetchVersions(server),
    ]);
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

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
        No data yet. Run{" "}
        <code className="font-mono text-tft-accent">
          python manage.py fetch_pbe
        </code>{" "}
        to populate the database.
      </div>
    );
  }

  return (
    <StatsTable
      data={data}
      versions={versions}
      selectedVersion={gameVersion}
      server={server}
    />
  );
}

export default async function Home({
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
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Unit Statistics</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Aggregated data from tracked pros final boards.
        </p>
      </div>

      <Suspense fallback={<PageSkeleton variant="table" />}>
        <StatsContent server={server} gameVersion={gameVersion ?? DEFAULT_GAME_VERSION} />
      </Suspense>
    </div>
  );
}
