"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { backendUrl } from "@/lib/backend";
import { UnitStat } from "./StatsTable";
import { TraitInfo } from "./WinningCompsList";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SearchUnit {
  character_id: string;
  star_level: number;
  cost: number;
  traits: string[];
  items: string[];
}

interface SearchComp {
  match_id: string;
  game_datetime: string;
  game_version: string;
  placement: number;
  level: number;
  player: string;
  units: SearchUnit[];
}

interface LobbyParticipant {
  name: string;
  placement: number;
  level: number;
  gold_left: number;
  units: SearchUnit[];
  augments: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatUnit(id: string): string {
  return id.replace(/^TFT\d+_/, "");
}

function formatItem(id: string): string {
  return id
    .replace(/^TFT\d+_Item_/, "")
    .replace(/^TFT_Item_/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

function itemImageUrl(itemId: string): string {
  const setMatch = itemId.match(/^TFT(\d+)_Item_(.+)$/i);
  if (setMatch) {
    const setNum = setMatch[1];
    const lower = itemId.toLowerCase();
    return `https://raw.communitydragon.org/pbe/game/assets/maps/particles/tft/item_icons/tft${setNum}/${lower}.tft_set${setNum}.png`;
  }
  const stdMatch = itemId.match(/^TFT_Item_(.+)$/i);
  if (stdMatch) {
    const name = stdMatch[1]
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase();
    return `https://raw.communitydragon.org/pbe/game/assets/maps/particles/tft/item_icons/standard/${name}.png`;
  }
  return "";
}

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

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

function costColor(cost: number): string {
  return COST_COLORS[cost] ?? "border-gray-500";
}

function placementBadge(p: number): string {
  if (p === 1) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  if (p <= 4) return "bg-green-500/20 text-green-400 border-green-500/40";
  return "bg-tft-surface text-tft-muted border-tft-border";
}

function placementStyle(p: number): string {
  if (p === 1) return "text-yellow-400 font-bold";
  if (p <= 4) return "text-green-400 font-semibold";
  return "text-tft-muted";
}

// ── Trait helpers ──────────────────────────────────────────────────────────────

interface TraitState {
  name: string;
  count: number;
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

// tier 0=unique, 1=bronze, 2=silver, 3=gold, 4=chromatic
const TRAIT_TIER_STYLES: Record<number, TierStyle> = {
  0: { chip: "bg-red-950/40 border-red-700/60",       num: "text-red-500",    iconColor: "#ef4444" },
  1: { chip: "bg-amber-950/40 border-amber-700/60",   num: "text-amber-600",  iconColor: "#d97706" },
  2: { chip: "bg-slate-800/40 border-slate-400/60",   num: "text-slate-300",  iconColor: "#cbd5e1" },
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" },
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" },
};

function computeTraits(
  units: SearchUnit[],
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

// ── UnitPicker (same pattern as DataExplorer) ──────────────────────────────────

function UnitPicker({
  units,
  onSelect,
}: {
  units: UnitStat[];
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
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-1.5 text-sm hover:border-tft-accent transition-colors min-w-[180px] text-left"
      >
        <span className="text-tft-muted">+ Add unit…</span>
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-56 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search unit…"
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={unitImageUrl(u.unit_name)}
                  alt=""
                  width={20}
                  height={20}
                  className={`w-5 h-5 rounded border ${costColor(u.cost)}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
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

// ── Sub-components ─────────────────────────────────────────────────────────────

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
  unit: SearchUnit;
  itemAssets: Record<string, string>;
  highlighted?: boolean;
}) {
  const border = highlighted
    ? "border-tft-gold ring-1 ring-tft-gold/50"
    : costColor(unit.cost);
  const traitTitle = unit.traits.length
    ? `${formatUnit(unit.character_id)} — ${unit.traits.join(", ")}`
    : formatUnit(unit.character_id);

  return (
    <div className={`relative border-2 rounded-lg ${border}`} title={traitTitle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={48}
        height={48}
        className="w-12 h-12 block rounded object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="absolute -top-3 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-3 left-0 right-0 flex justify-center z-10 pointer-events-none pb-0.5">
          {unit.items.map((item, i) => {
            const src = itemAssets[item] || itemImageUrl(item);
            if (!src) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={formatItem(item)}
                title={formatItem(item)}
                width={16}
                height={16}
                className="w-4 h-4 rounded object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function UnitChipSmall({
  unit,
  itemAssets,
}: {
  unit: SearchUnit;
  itemAssets: Record<string, string>;
}) {
  const border = costColor(unit.cost);
  return (
    <div
      className={`relative border-2 rounded ${border}`}
      title={`${formatUnit(unit.character_id)}${unit.traits.length ? ` — ${unit.traits.join(", ")}` : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={32}
        height={32}
        className="w-8 h-8 block rounded object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="absolute -top-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
          {unit.items.slice(0, 3).map((item, i) => {
            const src = itemAssets[item] || itemImageUrl(item);
            if (!src) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={formatItem(item)}
                title={formatItem(item)}
                width={12}
                height={12}
                className="w-3 h-3 rounded object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TraitChips({
  units,
  traitData,
}: {
  units: SearchUnit[];
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

function ResultCard({
  comp,
  itemAssets,
  traitData,
  searchedUnits,
}: {
  comp: SearchComp;
  itemAssets: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  searchedUnits: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const sortedUnits = comp.units
    .slice()
    .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level);

  function isHighlighted(unit: SearchUnit): boolean {
    return searchedUnits.some((q) =>
      unit.character_id.toLowerCase().includes(q.toLowerCase())
    );
  }

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoadingLobby(true);
      setLobbyError(null);
      try {
        const res = await fetch(`/api/match/${comp.match_id}/lobby/`);
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
      {/* Clickable header */}
      <div
        className="p-4 space-y-3 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-sm font-bold shrink-0 ${placementBadge(comp.placement)}`}
          >
            #{comp.placement}
          </span>
          <span className="text-tft-text font-medium">
            {displayPlayerName(comp.player)}
          </span>
          <span className="text-tft-muted text-xs">{formatDate(comp.game_datetime)}</span>
          {comp.game_version && (
            <span className="px-1.5 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted text-xs">
              {comp.game_version}
            </span>
          )}
          <span className="text-tft-muted text-xs">Lvl {comp.level}</span>
          <span className="text-tft-muted text-xs ml-auto">{expanded ? "▲" : "▼"}</span>
        </div>
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
        <TraitChips units={comp.units} traitData={traitData} />
      </div>

      {/* Expanded lobby */}
      {expanded && (
        <div className="border-t border-tft-border px-4 py-3 space-y-1">
          <p className="text-tft-muted text-xs font-semibold uppercase tracking-wide pb-1">Full match results</p>
          {loadingLobby && (
            <p className="text-tft-muted text-sm text-center py-4">Loading lobby…</p>
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
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`w-5 text-sm text-right shrink-0 ${placementStyle(participant.placement)}`}>
                    #{participant.placement}
                  </span>
                  <span className={`text-sm w-36 truncate shrink-0 ${isCurrentPlayer ? "text-tft-accent font-semibold" : "text-tft-text"}`}>
                    {displayPlayerName(participant.name)}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1.5 mb-1.5">
                    {participant.units
                      .slice()
                      .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                      .map((unit, j) => (
                        <UnitChipSmall key={j} unit={unit} itemAssets={itemAssets} />
                      ))}
                  </div>
                </div>
                <div className="ml-8 mt-1.5">
                  <TraitChips units={participant.units} traitData={traitData} />
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

export default function SearchComps({
  units,
  itemAssets,
  traitData,
}: {
  units: UnitStat[];
  itemAssets: Record<string, string>;
  traitData: Record<string, TraitInfo>;
}) {
  const [requiredUnits, setRequiredUnits] = useState<string[]>([]);
  const [sort, setSort] = useState<"recency" | "placement">("recency");
  const [results, setResults] = useState<SearchComp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitMap = useMemo(
    () => Object.fromEntries(units.map((u) => [u.unit_name, u])),
    [units]
  );

  const fetchResults = useCallback(
    async (selectedUnits: string[], sortMode: string) => {
      if (selectedUnits.length === 0) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const url = new URL(backendUrl("/api/search-comps/"));
        for (const u of selectedUnits) url.searchParams.append("unit", u);
        url.searchParams.set("sort", sortMode);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setResults(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error fetching results");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchResults(requiredUnits, sort);
  }, [requiredUnits, sort, fetchResults]);

  function addUnit(unitName: string) {
    if (requiredUnits.includes(unitName)) return;
    setRequiredUnits((prev) => [...prev, unitName]);
  }

  function removeUnit(unitName: string) {
    setRequiredUnits((prev) => prev.filter((u) => u !== unitName));
  }

  return (
    <div className="space-y-6">
      {/* Unit selector */}
      <div className="bg-tft-surface border border-tft-border rounded-xl p-4 space-y-3">
        <p className="text-tft-text text-sm font-semibold">Add required unit</p>
        <div className="flex flex-wrap gap-2 items-center">
          <UnitPicker units={units} onSelect={addUnit} />
        </div>

        {/* Selected unit tags */}
        {requiredUnits.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center pt-1">
            {requiredUnits.map((unitName) => {
              const info = unitMap[unitName];
              return (
                <div
                  key={unitName}
                  className="flex items-center gap-2 border border-green-600 bg-green-950/40 rounded-lg px-3 py-1.5 text-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={unitImageUrl(unitName)}
                    alt=""
                    width={18}
                    height={18}
                    className={`w-4.5 h-4.5 rounded border ${costColor(info?.cost ?? 0)}`}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
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
          </div>
        )}
      </div>

      {/* Sort controls */}
      {requiredUnits.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-tft-muted text-xs">Sort by:</span>
          <button
            onClick={() => setSort("recency")}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              sort === "recency"
                ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
            }`}
          >
            Most Recent
          </button>
          <button
            onClick={() => setSort("placement")}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              sort === "placement"
                ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
            }`}
          >
            Best Placement
          </button>
          {!loading && (
            <span className="text-tft-muted text-sm ml-auto">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
        </div>
      ) : requiredUnits.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Add one or more units above to search across all recorded comps.
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No comps found with {requiredUnits.map(formatUnit).join(" + ")}.
        </div>
      ) : (
        <div className="grid gap-4">
          {results.map((comp, i) => (
            <ResultCard
              key={`${comp.match_id}-${comp.placement}-${i}`}
              comp={comp}
              itemAssets={itemAssets}
              traitData={traitData}
              searchedUnits={requiredUnits}
            />
          ))}
        </div>
      )}
    </div>
  );
}
