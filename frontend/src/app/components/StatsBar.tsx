import { backendUrl } from "@/lib/backend";

interface GlobalStats {
  matches_analyzed: number;
  players_tracked: number;
  participants_recorded: number;
  last_fetch_at: string | null;
}

async function fetchGlobalStats(): Promise<GlobalStats | null> {
  try {
    const res = await fetch(backendUrl("/api/stats/"), {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function StatsBar() {
  const stats = await fetchGlobalStats();

  if (!stats) return null;

  return (
    <div className="border-b border-tft-border bg-tft-bg/60">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
        <Stat label="Matches analyzed" value={stats.matches_analyzed} />
        <Stat label="Players tracked" value={stats.players_tracked} />
        <Stat
          label="Participants recorded"
          value={stats.participants_recorded}
        />
        <span className="text-tft-muted text-xs ml-auto">
          {stats.last_fetch_at ? (
            <>
              Last run:{" "}
              <span className="text-tft-text">
                {formatDateTime(stats.last_fetch_at)}
              </span>
            </>
          ) : (
            <span className="italic">No runs yet</span>
          )}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs text-tft-muted">
      {label}:{" "}
      <span className="text-tft-gold font-semibold tabular-nums">
        {value.toLocaleString("en-US")}
      </span>
    </span>
  );
}
