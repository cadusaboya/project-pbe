"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backendUrl } from "@/lib/backend";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";

// ── Types ───────────────────────────────────────────────────────────────────────

export interface UnitStatBasic {
  unit_name: string;
  cost: number;
}

export interface WinningUnit {
  character_id: string;
  star_level: number;
  cost: number;
  traits: string[];
  items: string[];
}

export interface WinningComp {
  match_id: string;
  game_datetime: string;
  game_version: string;
  winner: string;
  placement: number;
  units: WinningUnit[];
}

interface DisplayComp {
  match_id: string;
  game_datetime: string;
  game_version: string;
  player: string;
  placement: number;
  level?: number;
  units: WinningUnit[];
}

interface LobbyParticipant {
  name: string;
  placement: number;
  level: number;
  gold_left: number;
  units: WinningUnit[];
  augments: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function displayPlayerName(name: string): string {
  return name.split("#")[0].trim();
}

// ── Trait helpers ─────────────────────────────────────────────────────────────

export interface TraitInfo {
  breakpoints: number[];
  icon: string;
}

interface TraitState {
  name: string;
  count: number;
  /** 0=unique, 1=bronze, 2=silver, 3=gold, 4=chromatic */
  tier: number;
  breakpoints: number[];
  icon: string;
  isUnique: boolean;
}

interface TierStyle {
  chip: string;
  num: string;
  iconColor: string;
}

const TRAIT_TIER_STYLES: Record<number, TierStyle> = {
  0: { chip: "bg-red-950/40 border-red-700/60",       num: "text-red-500",    iconColor: "#ef4444" },
  1: { chip: "bg-amber-950/40 border-amber-700/60",   num: "text-amber-600",  iconColor: "#d97706" },
  2: { chip: "bg-slate-800/40 border-slate-400/60",   num: "text-slate-300",  iconColor: "#cbd5e1" },
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" },
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" },
};

function computeTraits(
  units: WinningUnit[],
  traitData: Record<string, TraitInfo>
): TraitState[] {
  const counts: Record<string, number> = {};
  for (const unit of units) {
    for (const trait of unit.traits) {
      counts[trait] = (counts[trait] ?? 0) + 1;
    }
  }
  const result: TraitState[] = [];
  for (const [name, count] of Object.entries(counts)) {
    const info = traitData[name];
    const breakpoints = info?.breakpoints ?? [];
    const icon = info?.icon ?? "";
    let tier = 0;
    for (let i = 0; i < breakpoints.length; i++) {
      if (count >= breakpoints[i]) tier = i + 1;
    }
    if (tier > 0) {
      const isUnique = breakpoints.length === 1 && breakpoints[0] === 1;
      result.push({ name, count, tier: isUnique ? 0 : tier, breakpoints, icon, isUnique });
    }
  }
  return result.sort((a, b) => {
    if (a.isUnique !== b.isUnique) return a.isUnique ? 1 : -1;
    return b.tier - a.tier || b.count - a.count;
  });
}

function TraitChips({
  units,
  traitData,
}: {
  units: WinningUnit[];
  traitData: Record<string, TraitInfo>;
}) {
  const traits = computeTraits(units, traitData);
  if (traits.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {traits.map((t) => {
        const style = TRAIT_TIER_STYLES[t.tier] ?? TRAIT_TIER_STYLES[1];
        const activeBp = t.isUnique ? t.breakpoints[0] : t.breakpoints[t.tier - 1];
        const nextBp = t.isUnique ? undefined : t.breakpoints[t.tier];
        const suffix = nextBp != null ? `${t.count}/${nextBp}` : `${t.count}`;
        return (
          <span
            key={t.name}
            className={`inline-flex items-center gap-0.5 pl-0.5 pr-1.5 h-6 rounded border text-xs font-bold ${style.chip}`}
            title={`${t.name} ${suffix} — breakpoints ${t.breakpoints.join("/")}`}
          >
            {t.icon && (
              <span
                className="w-4 h-4 shrink-0 inline-block"
                style={{
                  backgroundColor: style.iconColor,
                  WebkitMaskImage: `url(${t.icon})`,
                  maskImage: `url(${t.icon})`,
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                }}
              />
            )}
            <span className={style.num}>{activeBp}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── UnitPicker ──────────────────────────────────────────────────────────────────

function UnitPicker({
  units,
  onSelect,
}: {
  units: UnitStatBasic[];
  onSelect: (unitName: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? units.filter(
          (u) =>
            u.unit_name.toLowerCase().includes(q) ||
            formatUnit(u.unit_name).toLowerCase().includes(q)
        )
      : units;
    return list.slice(0, 20);
  }, [units, search]);

  useEffect(() => { setHighlightedIndex(0); }, [filtered]);
  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function pick(unitName: string) {
    onSelect(unitName);
    setSearch("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlightedIndex]) pick(filtered[highlightedIndex].unit_name); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-2 text-sm hover:border-tft-accent transition-colors min-w-[140px] sm:min-w-[180px] text-left"
      >
        <span className="text-tft-muted">+ Filter by unit...</span>
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-52 sm:w-56 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search unit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded px-2 py-1 text-sm focus:outline-none focus:border-tft-accent"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.map((u, i) => (
              <button
                key={u.unit_name}
                onClick={() => pick(u.unit_name)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"}`}
              >
                <UnitImage characterId={u.unit_name} cost={u.cost} size={20} borderWidth={1} className="rounded" />
                <span className="text-tft-text text-sm">{formatUnit(u.unit_name)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-tft-muted text-sm text-center">No units found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function StarLevel({ level }: { level: number }) {
  const stars = "★".repeat(level);
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
  highlighted,
}: {
  unit: WinningUnit;
  itemAssets: Record<string, string>;
  highlighted?: boolean;
}) {
  const traitTitle = unit.traits.length
    ? `${formatUnit(unit.character_id)} — ${unit.traits.join(", ")}`
    : formatUnit(unit.character_id);

  return (
    <div
      className={`relative ${highlighted ? "ring-1 ring-tft-gold/50 rounded-lg" : ""}`}
      title={traitTitle}
    >
      <UnitImage
        characterId={unit.character_id}
        cost={unit.cost}
        size={44}
        className={highlighted ? "!border-tft-gold" : undefined}
      />
      <div className="absolute -top-3 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-3 left-0 right-0 flex justify-center z-10 pointer-events-none pb-0.5">
          {unit.items.map((item, i) => (
            <ItemImage
              key={i}
              itemId={item}
              itemAssets={itemAssets}
              size={16}
            />
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
  unit: WinningUnit;
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

// ── CompCard ────────────────────────────────────────────────────────────────────

function placementBadgeStyle(p: number): string {
  if (p === 1) return "bg-yellow-700/80 border-yellow-800 text-white";
  if (p <= 4) return "bg-teal-700/80 border-teal-800 text-white";
  if (p <= 6) return "bg-slate-700/80 border-slate-800 text-white/80";
  return "bg-rose-800/80 border-rose-900 text-white/80";
}

function lobbyPlacementStyle(p: number): string {
  if (p <= 4) return "bg-teal-700/80 border-teal-800 text-white";
  if (p <= 6) return "bg-slate-700/80 border-slate-800 text-white/80";
  return "bg-rose-800/80 border-rose-900 text-white/80";
}

function CompCard({
  comp,
  itemAssets,
  traitData,
  server,
  highlightedUnits,
}: {
  comp: DisplayComp;
  itemAssets: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  server: string;
  highlightedUnits?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const sortedUnits = comp.units
    .slice()
    .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level);

  function isHighlighted(unit: WinningUnit): boolean {
    if (!highlightedUnits || highlightedUnits.length === 0) return false;
    return highlightedUnits.some((q) =>
      unit.character_id.toLowerCase().includes(q.toLowerCase())
    );
  }

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoading(true);
      setLobbyError(null);
      try {
        const res = await fetch(`/api/match/${comp.match_id}/lobby?server=${encodeURIComponent(server)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLobby(await res.json());
      } catch (e) {
        setLobbyError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    }
    setExpanded((e) => !e);
  }

  return (
    <div className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden">
      {/* Header */}
      <div
        className="px-3 py-2.5 space-y-2 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3">
          <span className={`w-7 h-7 rounded border flex items-center justify-center text-xs font-bold shrink-0 ${placementBadgeStyle(comp.placement)}`}>
            {comp.placement}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <a
                href={`/${server.toLowerCase()}/player/${encodeURIComponent(comp.player.split("#")[0])}`}
                onClick={(e) => e.stopPropagation()}
                className="text-tft-text font-semibold hover:text-tft-gold truncate transition-colors"
              >
                {displayPlayerName(comp.player)}
              </a>
              {comp.level != null && (
                <span className="text-tft-muted text-xs">Lvl {comp.level}</span>
              )}
            </div>
            <div className="text-tft-muted text-xs mt-0.5 flex flex-wrap items-center gap-1.5">
              {formatDate(comp.game_datetime)}
              {comp.game_version && (
                <span className="px-1.5 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted">
                  {comp.game_version}
                </span>
              )}
            </div>
          </div>
          <span className="text-tft-muted text-xs shrink-0">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          <TraitChips units={comp.units} traitData={traitData} />
          <div className="flex flex-wrap gap-2">
            {sortedUnits.map((unit, i) => (
              <UnitChip
                key={i}
                unit={unit}
                itemAssets={itemAssets}
                highlighted={isHighlighted(unit)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Expanded lobby */}
      {expanded && (
        <div className="border-t border-tft-border px-4 py-3 space-y-1">
          {loading && (
            <p className="text-tft-muted text-sm text-center py-4">
              Loading lobby...
            </p>
          )}
          {lobbyError && (
            <p className="text-red-400 text-sm text-center py-4">
              {lobbyError}
            </p>
          )}
          {lobby &&
            lobby.map((participant, i, arr) => {
              const isCurrentPlayer =
                participant.placement === comp.placement &&
                displayPlayerName(participant.name) === displayPlayerName(comp.player);
              return (
                <div
                  key={i}
                  className={`py-1.5 ${
                    i < arr.length - 1 ? "border-b border-tft-border/40" : ""
                  } ${isCurrentPlayer ? "bg-tft-accent/5 rounded" : ""}`}
                >
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span
                      className={`w-6 h-6 rounded border flex items-center justify-center text-[10px] font-bold shrink-0 ${lobbyPlacementStyle(participant.placement)}`}
                    >
                      {participant.placement}
                    </span>
                    <a
                      href={`/${server.toLowerCase()}/player/${encodeURIComponent(participant.name.split("#")[0])}`}
                      onClick={(e) => e.stopPropagation()}
                      className={`text-sm w-24 sm:w-36 truncate shrink-0 hover:text-tft-gold transition-colors ${isCurrentPlayer ? "text-tft-accent font-semibold" : "text-tft-text"}`}
                    >
                      {displayPlayerName(participant.name)}
                    </a>
                    <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                      <TraitChips units={participant.units} traitData={traitData} />
                      <div className="flex flex-wrap gap-1">
                        {participant.units
                          .slice()
                          .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                          .map((unit, j) => (
                            <UnitChipSmall
                              key={j}
                              unit={unit}
                              itemAssets={itemAssets}
                            />
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

// ── Main component ──────────────────────────────────────────────────────────────

export default function WinningCompsList({
  data,
  itemAssets,
  versions,
  selectedVersion,
  traitData,
  server,
  allUnits,
}: {
  data: WinningComp[];
  itemAssets: Record<string, string>;
  versions: string[];
  selectedVersion: string;
  traitData: Record<string, TraitInfo>;
  server: string;
  allUnits: UnitStatBasic[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [playerSearch, setPlayerSearch] = useState("");
  const [requiredUnits, setRequiredUnits] = useState<string[]>([]);
  const [sort, setSort] = useState<"recency" | "placement">("recency");

  // Search mode state
  const [searchResults, setSearchResults] = useState<DisplayComp[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Infinite scroll
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

  // Fetch search results when units are selected
  useEffect(() => {
    if (requiredUnits.length === 0) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const fetchData = async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const url = new URL(backendUrl("/api/search-comps/"));
        for (const u of requiredUnits) url.searchParams.append("unit", u);
        url.searchParams.set("sort", sort);
        url.searchParams.set("server", server);
        if (selectedVersion) url.searchParams.set("game_version", selectedVersion);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setSearchResults(json);
      } catch (e) {
        if (!cancelled) setSearchError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [requiredUnits, sort, server, selectedVersion]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [playerSearch, requiredUnits, sort, data, searchResults]);

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, visibleCount]);

  function handleVersionChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("game_version", v);
    router.push(`/${server.toLowerCase()}/games-feed?${params.toString()}`);
  }

  function addUnit(unitName: string) {
    if (requiredUnits.includes(unitName)) return;
    setRequiredUnits((prev) => [...prev, unitName]);
  }

  function removeUnit(unitName: string) {
    setRequiredUnits((prev) => prev.filter((u) => u !== unitName));
  }

  // Build display list
  const isSearchMode = requiredUnits.length > 0;

  const displayData = useMemo<DisplayComp[]>(() => {
    let rows: DisplayComp[];

    if (isSearchMode && searchResults !== null) {
      rows = searchResults;
    } else if (!isSearchMode) {
      rows = data.map((c) => ({
        match_id: c.match_id,
        game_datetime: c.game_datetime,
        game_version: c.game_version,
        player: c.winner,
        placement: c.placement,
        units: c.units,
      }));
    } else {
      rows = [];
    }

    if (playerSearch.trim()) {
      const q = playerSearch.trim().toLowerCase();
      rows = rows.filter((r) =>
        displayPlayerName(r.player).toLowerCase().includes(q)
      );
    }

    return rows;
  }, [data, searchResults, playerSearch, isSearchMode]);

  const unitMap = useMemo(
    () => Object.fromEntries(allUnits.map((u) => [u.unit_name, u])),
    [allUnits]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center border border-tft-border rounded-xl bg-tft-surface/40 px-3 sm:px-4 py-2.5 sm:py-3">
        {versions.length > 0 && (
          <select
            value={selectedVersion}
            onChange={(e) => handleVersionChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent"
          >
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search player..."
          value={playerSearch}
          onChange={(e) => setPlayerSearch(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent flex-1 min-w-[120px] max-w-[200px]"
        />
        {allUnits.length > 0 && (
          <UnitPicker units={allUnits} onSelect={addUnit} />
        )}
        <span className="text-tft-muted text-xs sm:text-sm ml-auto">
          {searchLoading ? "Searching..." : `${displayData.length} results`}
        </span>
      </div>

      {/* Selected unit tags */}
      {requiredUnits.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {requiredUnits.map((unitName) => {
            const info = unitMap[unitName];
            return (
              <div
                key={unitName}
                className="flex items-center gap-2 border border-green-600 bg-green-950/40 rounded-lg px-3 py-1.5 text-sm"
              >
                <UnitImage characterId={unitName} cost={info?.cost ?? 0} size={18} borderWidth={1} className="rounded" />
                <span className="text-tft-text font-medium">{formatUnit(unitName)}</span>
                <button
                  onClick={() => removeUnit(unitName)}
                  className="text-tft-muted hover:text-tft-text text-base leading-none ml-0.5"
                  aria-label={`Remove ${formatUnit(unitName)}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setRequiredUnits([])}
            className="text-tft-muted hover:text-red-400 text-xs px-2 py-1.5 transition-colors"
          >
            Clear all
          </button>

          {/* Sort controls */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-tft-muted text-xs">Sort:</span>
            <button
              onClick={() => setSort("recency")}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                sort === "recency"
                  ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                  : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
              }`}
            >
              Recent
            </button>
            <button
              onClick={() => setSort("placement")}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                sort === "placement"
                  ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                  : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
              }`}
            >
              Placement
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {searchError && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {searchError}
        </div>
      )}

      {/* Cards */}
      {!searchError && (searchLoading ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Loading...
        </div>
      ) : displayData.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          {isSearchMode
            ? `No matches found with ${requiredUnits.map(formatUnit).join(" + ")}.`
            : "No matches found."}
        </div>
      ) : (
        <div className="grid gap-4">
          {displayData.slice(0, visibleCount).map((comp, i) => (
            <CompCard
              key={`${comp.match_id}-${comp.placement}-${i}`}
              comp={comp}
              itemAssets={itemAssets}
              traitData={traitData}
              server={server}
              highlightedUnits={isSearchMode ? requiredUnits : undefined}
            />
          ))}
          {visibleCount < displayData.length && (
            <div ref={sentinelRef} className="py-4 text-center text-tft-muted text-sm">
              Loading more...
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
