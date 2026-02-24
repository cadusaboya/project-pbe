import PlayerStatsList, { PlayerStat } from "../components/PlayerStatsList";
import { backendUrl } from "@/lib/backend";

async function fetchPlayerStats(server?: string): Promise<PlayerStat[]> {
  const url = new URL(backendUrl("/api/player-stats/"));
  if (server) url.searchParams.set("server", server);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch player stats: ${res.status}`);
  }
  return res.json();
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const { server = "PBE" } = await searchParams;
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
