"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { backendUrl } from "@/lib/backend";

interface GlobalStats {
  matches_analyzed: number;
  participants_recorded: number;
  last_fetch_at: string | null;
}


function formatRelativeUtc(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return "just now";

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(diffMs / dayMs);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function StatsBar() {
  const searchParams = useSearchParams();
  const server = searchParams.get("server") ?? "PBE";
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    const url = new URL(backendUrl("/api/stats/"));
    url.searchParams.set("server", server);
    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, [server]);

  if (!stats) return null;

  return (
    <div className="border-b border-tft-border bg-tft-bg/60">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 sm:py-2 flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1">
        <Stat label="Matches" value={stats.matches_analyzed} />
        <Stat label="Comps" value={stats.participants_recorded} />
        <span className="text-tft-muted text-xs ml-auto">
          {stats.last_fetch_at ? (
            <>
              Last run:{" "}
              <span className="text-tft-text">
                {formatRelativeUtc(stats.last_fetch_at)}
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
