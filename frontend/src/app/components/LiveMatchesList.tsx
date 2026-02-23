"use client";

import { useState, useEffect } from "react";

export interface LiveGameParticipant {
  puuid: string;
  riot_id: string;
  is_tracked: boolean;
}

export interface LiveGame {
  game_id: string;
  game_start_time: string;
  participants: LiveGameParticipant[];
  pro_player_count: number;
  last_checked_at: string;
}

function displayPlayerName(riotId: string): string {
  return riotId.split("#")[0].trim();
}

function ElapsedTime({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    function update() {
      const startMs = new Date(startTime).getTime();
      const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const minutes = Math.floor(diffSec / 60);
      const seconds = diffSec % 60;
      setElapsed(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return <span className="tabular-nums">{elapsed}</span>;
}

function LiveGameCard({ game }: { game: LiveGame }) {
  const tracked = game.participants.filter((p) => p.is_tracked);
  const untracked = game.participants.filter((p) => !p.is_tracked);

  return (
    <div className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden">
      <div className="px-4 py-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-tft-text font-semibold text-sm">
                Live Game
              </span>
              <span className="px-1.5 py-0.5 rounded bg-green-900/40 border border-green-700/40 text-green-400 text-xs font-medium">
                {game.pro_player_count} pro
                {game.pro_player_count !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="text-tft-muted text-xs mt-0.5">
              Game time: <ElapsedTime startTime={game.game_start_time} />
            </div>
          </div>
        </div>

        {/* Tracked players */}
        <div className="space-y-1">
          {tracked.map((p) => (
            <div key={p.puuid} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-tft-gold shrink-0" />
              <a
                href={`/player/${encodeURIComponent(displayPlayerName(p.riot_id))}`}
                className="text-tft-text text-sm font-medium hover:text-tft-gold transition-colors truncate"
              >
                {displayPlayerName(p.riot_id)}
              </a>
            </div>
          ))}
        </div>

        {/* Untracked players */}
        {untracked.length > 0 && (
          <div className="text-tft-muted text-xs">
            + {untracked.length} other player
            {untracked.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LiveMatchesList({
  initialData,
}: {
  initialData: LiveGame[];
}) {
  const [games, setGames] = useState<LiveGame[]>(initialData);
  const [, setLastRefresh] = useState(Date.now());

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/live-matches/");
        if (res.ok) {
          const data: LiveGame[] = await res.json();
          setGames(data);
          setLastRefresh(Date.now());
        }
      } catch {
        // Silently fail; keep showing stale data
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  if (games.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
        No live games at the moment. Check back later.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-tft-muted text-xs">
        {games.length} active game{games.length !== 1 ? "s" : ""}
        <span className="ml-2">Auto-refreshes every 60s</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <LiveGameCard key={game.game_id} game={game} />
        ))}
      </div>
    </div>
  );
}
