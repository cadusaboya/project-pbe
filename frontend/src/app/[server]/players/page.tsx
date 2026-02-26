import PlayerStatsList, { PlayerStat } from "../../components/PlayerStatsList";
import { fetchJson } from "@/lib/api";

async function fetchPlayerStats(server?: string): Promise<PlayerStat[]> {
  const params = new URLSearchParams();
  if (server) params.set("server", server);
  const qs = params.toString();
  return fetchJson<PlayerStat[]>(`/api/player-stats/${qs ? `?${qs}` : ""}`);
}

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ server: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  let data: PlayerStat[] = [];
  let error: string | null = null;

  try {
    data = await fetchPlayerStats(server);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Player Stats</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Rankings for all tracked players. Click a player to view their full profile.
        </p>
        {server === "PBE" && (
          <p className="text-sm mt-2">
            <a
              href="https://projectsbykai.com/project-pbe/leaderboards/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-tft-gold hover:underline"
            >
              Project PBE official leaderboard
            </a>
          </p>
        )}
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
