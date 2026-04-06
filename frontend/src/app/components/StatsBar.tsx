"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { backendUrl } from "@/lib/backend";
import { getServerFromPath, DEFAULT_PBE_QUEUE, DEFAULT_PBE_TIER } from "@/lib/constants";

interface GlobalStats {
  matches_analyzed: number;
  participants_recorded: number;
  last_fetch_at: string | null;
}
const CACHE_TTL = 300_000; // 5 minutes

function getCachedStats(server: string): GlobalStats | null {
  try {
    const raw = sessionStorage.getItem(`statsbar_${server}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function setCachedStats(server: string, data: GlobalStats) {
  try {
    sessionStorage.setItem(`statsbar_${server}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const server = getServerFromPath(pathname).toUpperCase();
  const isPbe = server === "PBE";
  const queue = isPbe ? (searchParams.get("queue") ?? DEFAULT_PBE_QUEUE) : "";
  const tier = isPbe
    ? (searchParams.get("tier") ?? (queue === "project_pbe" ? DEFAULT_PBE_TIER : ""))
    : (searchParams.get("tier") ?? "");
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Use cached data if fresh enough — skip network call entirely
    const cacheKey = [server, queue, tier].filter(Boolean).join("_");
    const cached = getCachedStats(cacheKey);
    if (cached) {
      setStats(cached);
      return;
    }

    // Fetch once on mount when cache is stale/empty.
    // No polling — FreshnessGuard reloads the page when new data arrives.
    const url = new URL(backendUrl("/api/stats/"));
    url.searchParams.set("server", server);
    if (queue) url.searchParams.set("queue", queue);
    if (tier) url.searchParams.set("tier", tier);
    fetch(url.toString(), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setStats(d);
        setCachedStats(cacheKey, d);
      })
      .catch(() => { if (!cancelled) setStats(null); });

    return () => { cancelled = true; };
  }, [server, queue, tier]);

  // Re-render every 60s so the relative time stays fresh
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  return (
    <div className="border-b border-tft-border bg-tft-bg/60">
      <div className="px-3 sm:px-6 py-1.5 sm:py-2 flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1">
        <Stat label="Matches" value={stats.matches_analyzed} />
        <Stat label="Comps" value={stats.participants_recorded} />
        <span className="text-tft-muted text-xs ml-auto">
          {stats.last_fetch_at ? (
            <>
              Last scan:{" "}
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
