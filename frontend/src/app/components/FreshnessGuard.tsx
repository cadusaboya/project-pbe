"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const COOLDOWN_KEY = "freshness_reload_at";
const COOLDOWN_MS = 60_000; // 60s — skip check if we just reloaded

/**
 * Checks whether the server-rendered data version is still current.
 * If the backend has newer data, shows a notification bar and reloads
 * so the user gets fresh content. Skips if a reload happened recently
 * to avoid loops when many games are added quickly.
 */
export default function FreshnessGuard({ dataVersion }: { dataVersion: number }) {
  const pathname = usePathname();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // Skip if we reloaded recently (prevents reload loop)
    const lastReload = Number(sessionStorage.getItem(COOLDOWN_KEY) || "0");
    if (Date.now() - lastReload < COOLDOWN_MS) return;

    let cancelled = false;

    fetch(`/api/freshness?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.data_version !== dataVersion) {
          setStale(true);
          sessionStorage.setItem(COOLDOWN_KEY, String(Date.now()));
          setTimeout(() => window.location.reload(), 600);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [dataVersion, pathname]);

  if (!stale) return null;

  return (
    <div className="border-b border-tft-gold/30 bg-tft-gold/10 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 flex items-center justify-center gap-2">
        <svg className="w-3.5 h-3.5 text-tft-gold animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs text-tft-gold font-medium">
          New matches found, updating...
        </span>
      </div>
    </div>
  );
}
