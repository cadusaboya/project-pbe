import { Suspense } from "react";
import PlayerStatsList, { PlayerStat } from "../../components/PlayerStatsList";
import VersionFilter from "../../components/VersionFilter";
import TierFilter from "../../components/TierFilter";
import PageSkeleton from "../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";
import { getDefaultVersion } from "@/lib/api";
import { DEFAULT_PBE_TIER, DEFAULT_PBE_QUEUE } from "@/lib/constants";

async function fetchPlayerStats(server?: string, gameVersion?: string, tier?: string, queue?: string): Promise<PlayerStat[]> {
  const params = new URLSearchParams();
  if (server) params.set("server", server);
  if (gameVersion) params.set("game_version", gameVersion);
  if (tier) params.set("tier", tier);
  if (queue) params.set("queue", queue);
  const qs = params.toString();
  return fetchJson<PlayerStat[]>(`/api/player-stats/${qs ? `?${qs}` : ""}`);
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

async function PlayersContent({
  server,
  gameVersion,
  tier,
  queue,
}: {
  server: string;
  gameVersion: string;
  tier?: string;
  queue?: string;
}) {
  let data: PlayerStat[] = [];
  let versions: string[] = [];
  let error: string | null = null;

  try {
    [data, versions] = await Promise.all([
      fetchPlayerStats(server, gameVersion, tier, queue),
      fetchVersions(server),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <VersionFilter versions={versions} selectedVersion={gameVersion} />
        <Suspense fallback={null}><TierFilter /></Suspense>
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
          No player data available.
        </div>
      ) : (
        <PlayerStatsList data={data} server={server} />
      )}
    </div>
  );
}

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string; tier?: string; queue?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { game_version: gameVersion, tier: rawTier, queue: rawQueue } = await searchParams;
  const isPbe = server === "PBE";
  const tier = rawTier ?? (isPbe ? DEFAULT_PBE_TIER : undefined);
  const queue = rawQueue ?? (isPbe ? DEFAULT_PBE_QUEUE : undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Player Stats</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Rankings for all tracked players. Click a player to view their full profile.
        </p>
      </div>

      <Suspense fallback={<PageSkeleton variant="table" />}>
        <PlayersContent server={server} gameVersion={gameVersion ?? await getDefaultVersion(server)} tier={tier} queue={queue} />
      </Suspense>
    </div>
  );
}
