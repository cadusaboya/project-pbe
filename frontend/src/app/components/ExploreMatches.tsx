"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { backendUrl } from "@/lib/backend";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";
import { formatDate, displayPlayerName, placementBadge, placementStyle } from "@/lib/formatters";
import type { BoardUnit, LobbyParticipant, TraitInfo } from "@/lib/types";
import TraitChips from "./TraitChips";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MatchResult {
  match_id: string;
  game_datetime: string;
  game_version: string;
  placement: number;
  level: number;
  player: string;
  units: BoardUnit[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StarLevel({ level }: { level: number }) {
  const stars = "\u2605".repeat(level);
  const colors = ["", "text-amber-700", "text-slate-300", "text-yellow-400"];
  return (
    <span className={`text-xs font-bold leading-none ${colors[level] ?? "text-gray-400"}`}>
      {stars}
    </span>
  );
}

function UnitChip({
  unit,
  itemAssets,
}: {
  unit: BoardUnit;
  itemAssets: Record<string, string>;
}) {
  const traitTitle = unit.traits.length
    ? `${formatUnit(unit.character_id)} — ${unit.traits.join(", ")}`
    : formatUnit(unit.character_id);

  return (
    <div className="relative rounded-lg" title={traitTitle}>
      <UnitImage characterId={unit.character_id} cost={unit.cost} size={48} className="block rounded" />
      <div className="absolute -top-3 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-3 left-0 right-0 flex justify-center z-10 pointer-events-none pb-0.5">
          {unit.items.map((item, i) => (
            <ItemImage key={i} itemId={item} itemAssets={itemAssets} size={16} className="rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitChipSmall({
  unit,
  itemAssets,
}: {
  unit: BoardUnit;
  itemAssets: Record<string, string>;
}) {
  return (
    <div
      className="relative rounded"
      title={`${formatUnit(unit.character_id)}${unit.traits.length ? ` — ${unit.traits.join(", ")}` : ""}`}
    >
      <UnitImage characterId={unit.character_id} cost={unit.cost} size={32} className="block rounded" />
      <div className="absolute -top-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
          {unit.items.slice(0, 3).map((item, i) => (
            <ItemImage key={i} itemId={item} itemAssets={itemAssets} size={12} className="rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  comp,
  itemAssets,
  traitData,
  server,
}: {
  comp: MatchResult;
  itemAssets: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  server: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const sortedUnits = comp.units
    .slice()
    .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level);

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoadingLobby(true);
      setLobbyError(null);
      try {
        const res = await fetch(`/api/match/${comp.match_id}/lobby/?server=${encodeURIComponent(server)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLobby(await res.json());
      } catch (e) {
        setLobbyError(e instanceof Error ? e.message : "Error loading lobby");
      } finally {
        setLoadingLobby(false);
      }
    }
    setExpanded((v) => !v);
  }

  return (
    <div className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden">
      <div
        className="p-3 sm:p-4 space-y-3 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-sm font-bold shrink-0 ${placementBadge(comp.placement)}`}
          >
            #{comp.placement}
          </span>
          <a
            href={`/${server.toLowerCase()}/player/${encodeURIComponent(comp.player.split("#")[0])}`}
            onClick={(e) => e.stopPropagation()}
            className="text-tft-text font-medium hover:text-tft-gold transition-colors"
          >
            {displayPlayerName(comp.player)}
          </a>
          <span className="text-tft-muted text-xs">{formatDate(comp.game_datetime)}</span>
          {comp.game_version && (
            <span className="px-1.5 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted text-xs">
              {comp.game_version}
            </span>
          )}
          <span className="text-tft-muted text-xs">Lvl {comp.level}</span>
          <span className="text-tft-muted text-xs ml-auto">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sortedUnits.map((unit, i) => (
            <UnitChip key={i} unit={unit} itemAssets={itemAssets} />
          ))}
        </div>
        <TraitChips units={comp.units} traitData={traitData} />
      </div>

      {expanded && (
        <div className="border-t border-tft-border px-3 sm:px-4 py-3 space-y-1">
          <p className="text-tft-muted text-xs font-semibold uppercase tracking-wide pb-1">Full match results</p>
          {loadingLobby && (
            <p className="text-tft-muted text-sm text-center py-4">Loading lobby...</p>
          )}
          {lobbyError && (
            <p className="text-red-400 text-sm text-center py-4">{lobbyError}</p>
          )}
          {lobby && lobby.map((participant, i, arr) => {
            const isCurrentPlayer =
              participant.placement === comp.placement &&
              displayPlayerName(participant.name) === displayPlayerName(comp.player);
            return (
              <div
                key={i}
                className={`py-1.5 ${i < arr.length - 1 ? "border-b border-tft-border/40" : ""} ${isCurrentPlayer ? "bg-tft-accent/5 rounded" : ""}`}
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className={`w-5 text-sm text-right shrink-0 ${placementStyle(participant.placement)}`}>
                    #{participant.placement}
                  </span>
                  <a
                    href={`/${server.toLowerCase()}/player/${encodeURIComponent(participant.name.split("#")[0])}`}
                    onClick={(e) => e.stopPropagation()}
                    className={`text-sm w-24 sm:w-36 truncate shrink-0 hover:text-tft-gold transition-colors ${isCurrentPlayer ? "text-tft-accent font-semibold" : "text-tft-text"}`}
                  >
                    {displayPlayerName(participant.name)}
                  </a>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <TraitChips units={participant.units} traitData={traitData} />
                    <div className="flex flex-wrap gap-1">
                      {participant.units
                        .slice()
                        .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                        .map((unit, j) => (
                          <UnitChipSmall key={j} unit={unit} itemAssets={itemAssets} />
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function ExploreMatches({
  filterParams,
  itemAssets,
  traitData,
  server,
}: {
  filterParams: string;
  itemAssets: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  server: string;
}) {
  const [results, setResults] = useState<MatchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const sep = filterParams.includes("?") ? "&" : "?";
        const url = backendUrl(
          `/api/explore/matches/${filterParams}${sep}limit=${PAGE_SIZE}&offset=${offset}`
        );
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setTotal(data.total);
        if (append) {
          setResults((prev) => [...prev, ...data.results]);
        } else {
          setResults(data.results);
        }
        hasMoreRef.current = offset + data.results.length < data.total;
        offsetRef.current = offset + data.results.length;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error fetching matches");
      } finally {
        setLoading(false);
        setInitialLoading(false);
        loadingRef.current = false;
      }
    },
    [filterParams]
  );

  // Reset and fetch first page when filter params change
  useEffect(() => {
    setResults([]);
    setTotal(0);
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setInitialLoading(true);
    fetchPage(0, false);
  }, [fetchPage]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          fetchPage(offsetRef.current, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchPage]);

  if (initialLoading) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
        Loading matches...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
        <span className="font-semibold">Error:</span> {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
        No matches found for these conditions.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-tft-muted text-sm">
        {total.toLocaleString("en-US")} matching board{total !== 1 ? "s" : ""}
      </p>
      <div className="grid gap-4">
        {results.map((comp, i) => (
          <MatchCard
            key={`${comp.match_id}-${comp.placement}-${i}`}
            comp={comp}
            itemAssets={itemAssets}
            traitData={traitData}
            server={server}
          />
        ))}
      </div>
      {hasMoreRef.current && (
        <div ref={sentinelRef} className="py-4 text-center text-tft-muted text-sm">
          {loading ? "Loading more..." : ""}
        </div>
      )}
    </div>
  );
}
