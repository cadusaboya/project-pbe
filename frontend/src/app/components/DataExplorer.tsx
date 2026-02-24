"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backendUrl } from "@/lib/backend";
import { UnitStat } from "./StatsTable";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnitFilter {
  id: string;
  kind: "unit";
  unit: string;
  excluded: boolean;
  starLevel: number; // 0 = any
  itemCount: number; // -1 = any
  requiredCount: number; // 1 = normal, 2+ = require multiple copies
}

interface TraitFilter {
  id: string;
  kind: "trait";
  trait: string;
  breakpoint: number;      // min breakpoint (unit count)
  maxBreakpoint: number;   // max breakpoint (unit count), 0 = no limit
  excluded: boolean;       // true = exclude boards where trait reaches this breakpoint
}

interface ItemFilter {
  id: string;
  kind: "item";
  item: string;
  excluded: boolean; // true = ban from comp, false = require in comp
  holder: string; // unit character_id that holds this item, "" = any
}

interface LevelFilter {
  id: string;
  kind: "level";
  level: number;
}

type Filter = UnitFilter | TraitFilter | ItemFilter | LevelFilter;

interface UnitResult {
  unit_name: string;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  delta: number;
}

interface ItemResult {
  unit_name: string;
  item_name: string;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  delta: number;
}

interface UnitCountResult {
  unit_name: string;
  count: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  delta: number;
}

interface TraitResult {
  trait_name: string;
  tier: number;
  num_units: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  delta: number;
}

interface ExploreResponse {
  base_games: number;
  base_avg_placement: number;
  base_top4_rate: number;
  base_win_rate: number;
  unit_stats: UnitResult[];
  unit_count_stats: UnitCountResult[];
  item_stats: ItemResult[];
  trait_stats?: TraitResult[];
}

type SortDir = "asc" | "desc";
type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

let _itemNamesCache: Record<string, string> = {};

function formatItemName(name: string): string {
  if (_itemNamesCache[name]) return _itemNamesCache[name];
  return name.replace(/^TFT\d*_Item_/, "").replace(/([A-Z])/g, " $1").trim();
}

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

function costBorderColor(cost: number) {
  return COST_COLORS[cost] ?? "border-gray-500";
}

function placementColor(v: number) {
  if (v <= 2) return "text-yellow-400 font-semibold";
  if (v <= 4) return "text-green-400";
  if (v <= 6) return "text-tft-text";
  return "text-red-400";
}

function deltaColor(d: number) {
  if (d < -0.5) return "text-green-400 font-bold";
  if (d < 0) return "text-green-400";
  if (d === 0) return "text-tft-muted";
  if (d <= 0.5) return "text-red-400";
  return "text-red-400 font-bold";
}

const TRAIT_TIER_STYLES: Record<number, { chip: string; num: string; iconColor: string }> = {
  0: { chip: "bg-red-950/40 border-red-700/60",       num: "text-red-500",    iconColor: "#ef4444" },
  1: { chip: "bg-amber-950/40 border-amber-700/60",   num: "text-amber-600",  iconColor: "#d97706" },
  2: { chip: "bg-slate-800/40 border-slate-400/60",   num: "text-slate-300",  iconColor: "#cbd5e1" },
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" },
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" },
};

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── Unified search dropdown ────────────────────────────────────────────────────

type SearchResultItem =
  | { kind: "unit"; unit: UnitStat; excluded?: boolean }
  | { kind: "unit_count"; unit: UnitStat; count: number }
  | { kind: "trait"; trait: string; icon: string; excluded?: boolean }
  | { kind: "item"; item: string; icon: string; excluded?: boolean }
  | { kind: "level"; level: number };

function UnifiedSearch({
  units,
  traitData,
  itemAssets,
  filters,
  onSelect,
}: {
  units: UnitStat[];
  traitData: TraitData;
  itemAssets: Record<string, string>;
  filters: Filter[];
  onSelect: (item: SearchResultItem) => void;
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

  const allTraits = useMemo(() => Object.keys(traitData).sort(), [traitData]);
  const allItems = useMemo(
    () => Object.keys(itemAssets).filter(
      (i) => (i.startsWith("TFT_Item_") || i.startsWith("TFT16_Item_")) && !i.includes("Augment")
    ).sort(),
    [itemAssets]
  );

  // Track requiredCount for each unit already in filters
  const unitFilterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of filters) {
      if (f.kind === "unit" && !f.excluded) {
        counts.set(f.unit, f.requiredCount);
      }
    }
    return counts;
  }, [filters]);

  const filtered = useMemo<SearchResultItem[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    const matchingUnits = units.filter(
      (u) =>
        u.unit_name.toLowerCase().includes(q) ||
        formatUnit(u.unit_name).toLowerCase().includes(q)
    ).slice(0, 8);

    const unitResults: SearchResultItem[] = matchingUnits.flatMap((u) => {
      const existing = unitFilterCounts.get(u.unit_name) ?? 0;
      const results: SearchResultItem[] = [];
      if (existing === 0) {
        // Not yet selected — show normal include + exclude
        results.push({ kind: "unit" as const, unit: u });
        results.push({ kind: "unit" as const, unit: u, excluded: true });
      } else if (existing < 3) {
        // Already selected — show "2nd X" / "3rd X" option (max 3)
        const nextCount = existing + 1;
        results.push({ kind: "unit_count" as const, unit: u, count: nextCount });
      }
      return results;
    });

    const traitResults: SearchResultItem[] = allTraits
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 5)
      .flatMap((t) => [
        { kind: "trait" as const, trait: t, icon: traitData[t]?.icon ?? "" },
        { kind: "trait" as const, trait: t, icon: traitData[t]?.icon ?? "", excluded: true },
      ]);

    const matchingItems = allItems.filter(
      (i) => formatItemName(i).toLowerCase().includes(q) || i.toLowerCase().includes(q)
    ).slice(0, 6);

    const itemResults: SearchResultItem[] = matchingItems.flatMap((i) => [
      { kind: "item" as const, item: i, icon: itemAssets[i] ?? "" },
      { kind: "item" as const, item: i, icon: itemAssets[i] ?? "", excluded: true },
    ]);

    const LEVELS = [8, 9, 10];
    const levelResults: SearchResultItem[] = LEVELS
      .filter((l) => `level ${l}`.includes(q) || `lv${l}`.includes(q) || q === String(l))
      .map((l) => ({ kind: "level" as const, level: l }));

    return [...unitResults, ...traitResults, ...itemResults, ...levelResults];
  }, [units, allTraits, traitData, allItems, itemAssets, search, unitFilterCounts]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered]);

  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function handleSelect(item: SearchResultItem) {
    onSelect(item);
    setSearch("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightedIndex]) handleSelect(filtered[highlightedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search a Unit, Trait, or Item..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-tft-accent transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 top-full left-0 mt-1 w-full bg-tft-surface border border-tft-border rounded-lg shadow-xl overflow-hidden">
          <div ref={listRef} className="max-h-72 overflow-y-auto">
            {filtered.map((item, i) => {
              let key = "";
              if (item.kind === "unit") key = `unit-${item.unit.unit_name}${item.excluded ? "-ex" : ""}`;
              else if (item.kind === "unit_count") key = `unit-count-${item.unit.unit_name}-${item.count}`;
              else if (item.kind === "trait") key = `trait-${item.trait}${item.excluded ? "-ex" : ""}`;
              else if (item.kind === "item") key = `item-${item.item}${item.excluded ? "-ex" : ""}`;
              else key = `level-${item.level}`;

              return (
                <button
                  key={key}
                  onClick={() => handleSelect(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"
                  }`}
                >
                  {item.kind === "unit" && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={unitImageUrl(item.unit.unit_name)}
                        alt=""
                        width={28}
                        height={28}
                        className={`w-7 h-7 rounded-lg border-2 ${costBorderColor(item.unit.cost)} ${item.excluded ? "grayscale opacity-50" : ""}`}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className={`text-sm font-medium ${item.excluded ? "text-red-400" : "text-tft-text"}`}>
                        {item.excluded ? `Exclude ${formatUnit(item.unit.unit_name)}` : formatUnit(item.unit.unit_name)}
                      </span>
                    </>
                  )}
                  {item.kind === "unit_count" && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={unitImageUrl(item.unit.unit_name)}
                        alt=""
                        width={28}
                        height={28}
                        className={`w-7 h-7 rounded-lg border-2 ${costBorderColor(item.unit.cost)}`}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className="text-sm font-medium text-amber-400">
                        {item.count === 2 ? "2nd" : `${item.count}rd`} {formatUnit(item.unit.unit_name)}
                      </span>
                      <span className="text-tft-muted text-xs ml-auto">{item.count}x</span>
                    </>
                  )}
                  {item.kind === "trait" && (
                    <>
                      {item.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.icon}
                          alt=""
                          width={24}
                          height={24}
                          className={`w-6 h-6 rounded object-cover ${item.excluded ? "grayscale opacity-50" : ""}`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <span className={`text-sm font-medium ${item.excluded ? "text-red-400" : "text-tft-text"}`}>
                        {item.excluded ? `Exclude ${item.trait}` : item.trait}
                      </span>
                      {!item.excluded && (
                        <span className="text-tft-muted text-xs ml-auto">Trait</span>
                      )}
                    </>
                  )}
                  {item.kind === "item" && (
                    <>
                      {item.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.icon}
                          alt=""
                          width={24}
                          height={24}
                          className={`w-6 h-6 rounded object-cover ${item.excluded ? "grayscale opacity-50" : ""}`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <span className={`text-sm font-medium ${item.excluded ? "text-red-400" : "text-tft-text"}`}>
                        {item.excluded ? `Exclude ${formatItemName(item.item)}` : formatItemName(item.item)}
                      </span>
                      {!item.excluded && (
                        <span className="text-tft-muted text-xs ml-auto">Item</span>
                      )}
                    </>
                  )}
                  {item.kind === "level" && (
                    <>
                      <span className="w-7 h-7 rounded-lg bg-tft-accent/20 border border-tft-accent/40 flex items-center justify-center text-tft-text text-xs font-bold">
                        {item.level}
                      </span>
                      <span className="text-tft-text text-sm font-medium">
                        Player Level {item.level}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter chip ────────────────────────────────────────────────────────────────

function UnitFilterChip({
  filter,
  unitInfo,
  onUpdate,
  onRemove,
}: {
  filter: UnitFilter;
  unitInfo?: UnitStat;
  onUpdate: (updated: UnitFilter) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${
        filter.excluded
          ? "border-red-700 bg-red-950/40"
          : "border-green-600 bg-green-950/40"
      }`}
    >
      {/* Unit image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(filter.unit)}
        alt=""
        width={36}
        height={36}
        className={`w-9 h-9 rounded-lg border-2 ${costBorderColor(unitInfo?.cost ?? 0)}`}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />

      {/* Name + dropdowns stacked */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {filter.requiredCount >= 2 && (
            <span className="text-amber-400 text-xs font-bold">{filter.requiredCount}x</span>
          )}
          <span className="text-tft-text text-sm font-semibold leading-tight">
            {formatUnit(filter.unit)}
          </span>
        </div>

        {!filter.excluded && (
          <div className="flex items-center gap-2">
            {/* Star level dropdown */}
            <div className="flex items-center gap-1">
              <span className="text-tft-muted text-[10px]">Stars</span>
              <select
                value={filter.starLevel}
                onChange={(e) => onUpdate({ ...filter, starLevel: Number(e.target.value) })}
                className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent"
              >
                <option value={0}>Any</option>
                <option value={1}>1★</option>
                <option value={2}>2★</option>
                <option value={3}>3★</option>
              </select>
            </div>

            {/* Item count dropdown */}
            <div className="flex items-center gap-1">
              <span className="text-tft-muted text-[10px]">Items</span>
              <select
                value={filter.itemCount}
                onChange={(e) => onUpdate({ ...filter, itemCount: Number(e.target.value) })}
                className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent"
              >
                <option value={-1}>Any</option>
                <option value={0}>0</option>
                <option value={1}>1+</option>
                <option value={2}>2+</option>
                <option value={3}>3</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="text-tft-muted hover:text-red-400 text-lg leading-none ml-1 transition-colors"
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

function TraitFilterChip({
  filter,
  traitData,
  onUpdate,
  onRemove,
}: {
  filter: TraitFilter;
  traitData: TraitData;
  onUpdate: (updated: TraitFilter) => void;
  onRemove: () => void;
}) {
  const info = traitData[filter.trait];
  const breakpoints = info?.breakpoints ?? [];

  return (
    <div className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${filter.excluded ? "border-red-600 bg-red-950/40" : "border-teal-600 bg-teal-950/40"}`}>
      {info?.icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info.icon}
          alt=""
          width={28}
          height={28}
          className="w-7 h-7 rounded object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {filter.excluded && <span className="text-red-400 text-xs font-bold">EXCLUDE</span>}
          <span className="text-tft-text text-sm font-semibold leading-tight">{filter.trait}</span>
        </div>

        {breakpoints.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-tft-muted text-[10px]">Min</span>
              <select
                value={filter.breakpoint}
                onChange={(e) => onUpdate({ ...filter, breakpoint: Number(e.target.value) })}
                className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent"
              >
                {breakpoints.map((bp) => (
                  <option key={bp} value={bp}>
                    {bp}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-tft-muted text-[10px]">Max</span>
              <select
                value={filter.maxBreakpoint}
                onChange={(e) => onUpdate({ ...filter, maxBreakpoint: Number(e.target.value) })}
                className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent"
              >
                {breakpoints.map((bp) => (
                  <option key={bp} value={bp}>
                    {bp}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        className="text-tft-muted hover:text-red-400 text-lg leading-none ml-1 transition-colors"
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

function ItemFilterChip({
  filter,
  itemAssets,
  units,
  onUpdate,
  onRemove,
}: {
  filter: ItemFilter;
  itemAssets: Record<string, string>;
  units: UnitStat[];
  onUpdate: (updated: ItemFilter) => void;
  onRemove: () => void;
}) {
  const imgUrl = itemAssets[filter.item];

  return (
    <div
      className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${
        filter.excluded
          ? "border-red-700 bg-red-950/40"
          : "border-blue-600 bg-blue-950/30"
      }`}
    >
      {imgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgUrl}
          alt=""
          width={28}
          height={28}
          className={`w-7 h-7 rounded object-cover ${filter.excluded ? "grayscale opacity-50" : ""}`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-tft-text text-sm font-semibold leading-tight">
          {formatItemName(filter.item)}
        </span>
        {filter.excluded ? (
          <span className="text-red-400 text-[10px]">Excluded</span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-tft-muted text-[10px]">Holder</span>
            <select
              value={filter.holder}
              onChange={(e) => onUpdate({ ...filter, holder: e.target.value })}
              className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent max-w-[100px]"
            >
              <option value="">Any</option>
              {units.map((u) => (
                <option key={u.unit_name} value={u.unit_name}>
                  {formatUnit(u.unit_name)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        className="text-tft-muted hover:text-red-400 text-lg leading-none ml-1 transition-colors"
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

function LevelFilterChip({
  filter,
  onUpdate,
  onRemove,
}: {
  filter: LevelFilter;
  onUpdate: (updated: LevelFilter) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border border-tft-accent bg-tft-accent/10 rounded-xl px-3 py-2">
      <span className="w-7 h-7 rounded-lg bg-tft-accent/20 border border-tft-accent/40 flex items-center justify-center text-tft-text text-xs font-bold">
        {filter.level}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-tft-text text-sm font-semibold leading-tight">Player Level</span>
        <div className="flex items-center gap-1">
          <span className="text-tft-muted text-[10px]">Level</span>
          <select
            value={filter.level}
            onChange={(e) => onUpdate({ ...filter, level: Number(e.target.value) })}
            className="bg-tft-bg border border-tft-border text-tft-text rounded px-1 py-0 text-[11px] focus:outline-none focus:border-tft-accent"
          >
            {Array.from({ length: 11 }, (_, i) => i + 1).map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="text-tft-muted hover:text-red-400 text-lg leading-none ml-1 transition-colors"
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

// ── Sortable table helpers ─────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-tft-muted opacity-40 select-none">↕</span>;
  return <span className="ml-1 text-tft-gold select-none">{dir === "asc" ? "↑" : "↓"}</span>;
}

// ── Convert filters to API params ──────────────────────────────────────────────

function filtersToParams(filters: Filter[], version: string, traitData: TraitData): URLSearchParams {
  const params = new URLSearchParams();
  if (version) params.set("game_version", version);

  for (const f of filters) {
    if (f.kind === "unit") {
      if (f.excluded) {
        params.append("ban_unit", f.unit);
      } else {
        params.append("require_unit", f.unit);
        if (f.requiredCount >= 2) {
          params.append("require_unit_count", `${f.unit}:${f.requiredCount}`);
        }
      }
      if (f.starLevel > 0) {
        params.append("require_unit_star", `${f.unit}:${f.starLevel}`);
      }
      if (f.itemCount >= 0) {
        params.append("require_unit_item_count", `${f.unit}:${f.itemCount}`);
      }
    } else if (f.kind === "trait") {
      if (f.excluded) {
        params.append("exclude_trait", `${f.trait}:${f.breakpoint}`);
      } else {
        const bps = traitData[f.trait]?.breakpoints ?? [];
        const minTier = bps.indexOf(f.breakpoint) + 1;
        params.append("require_trait_tier", `${f.trait}:${minTier || 1}`);
        const maxTier = bps.indexOf(f.maxBreakpoint) + 1;
        if (maxTier > 0) {
          params.append("require_trait_max_tier", `${f.trait}:${maxTier}`);
        }
      }
    } else if (f.kind === "item") {
      if (f.excluded) {
        params.append("exclude_item", f.item);
      } else if (f.holder) {
        params.append("require_item_on_unit", `${f.holder}::${f.item}`);
      }
      // If included with holder = "" (Any), no specific API param — item presence isn't filtered
    } else if (f.kind === "level") {
      params.append("player_level", String(f.level));
    }
  }

  return params;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DataExplorer({
  units,
  versions,
  selectedVersion: initialVersion,
  initialConditions = [],
  traitData = {},
}: {
  units: UnitStat[];
  versions: string[];
  selectedVersion: string;
  initialConditions?: { type: string; unit?: string; trait?: string; count?: number; star?: number; level?: number; item?: string; itemCount?: number }[];
  traitData?: TraitData;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedVersion, setSelectedVersion] = useState(initialVersion);
  const [minFrequency, setMinFrequency] = useState(0);
  const [filters, setFilters] = useState<Filter[]>(() => {
    // Convert legacy initialConditions to new Filter format
    const result: Filter[] = [];
    const unitFilterMap = new Map<string, UnitFilter>();

    for (const c of initialConditions) {
      if (c.type === "require_unit" && c.unit) {
        if (!unitFilterMap.has(c.unit)) {
          const f: UnitFilter = {
            id: uid(),
            kind: "unit",
            unit: c.unit,
            excluded: false,
            starLevel: 0,
            itemCount: -1,
            requiredCount: 1,
          };
          unitFilterMap.set(c.unit, f);
          result.push(f);
        }
      } else if (c.type === "ban_unit" && c.unit) {
        if (!unitFilterMap.has(c.unit)) {
          const f: UnitFilter = {
            id: uid(),
            kind: "unit",
            unit: c.unit,
            excluded: true,
            starLevel: 0,
            itemCount: -1,
            requiredCount: 1,
          };
          unitFilterMap.set(c.unit, f);
          result.push(f);
        }
      } else if (c.type === "require_trait" && c.trait) {
        const bps = traitData[c.trait]?.breakpoints ?? [];
        result.push({
          id: uid(),
          kind: "trait",
          trait: c.trait,
          breakpoint: c.count ?? 1,
          maxBreakpoint: bps.length > 0 ? bps[bps.length - 1] : c.count ?? 1,
          excluded: false,
        });
      } else if (c.type === "exclude_trait" && c.trait) {
        const bps = traitData[c.trait]?.breakpoints ?? [];
        result.push({
          id: uid(),
          kind: "trait",
          trait: c.trait,
          breakpoint: c.count ?? 1,
          maxBreakpoint: bps.length > 0 ? bps[bps.length - 1] : c.count ?? 1,
          excluded: true,
        });
      } else if (c.type === "require_unit_count" && c.unit) {
        const existing = unitFilterMap.get(c.unit);
        if (existing) {
          existing.requiredCount = c.count ?? 2;
        }
      } else if (c.type === "require_unit_star" && c.unit) {
        const existing = unitFilterMap.get(c.unit);
        if (existing) {
          existing.starLevel = c.star ?? 2;
        }
      } else if (c.type === "require_unit_item_count" && c.unit) {
        const existing = unitFilterMap.get(c.unit);
        if (existing) {
          existing.itemCount = c.itemCount ?? 3;
        }
      } else if (c.type === "player_level" && c.level) {
        result.push({ id: uid(), kind: "level", level: c.level });
      }
    }
    return result;
  });

  // Data
  const [exploreData, setExploreData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [itemAssets, setItemAssets] = useState<Record<string, string>>({});

  // Table
  const [activeTab, setActiveTab] = useState<"units" | "items" | "traits">("units");
  const [unitSortKey, setUnitSortKey] = useState<"games" | "avg_placement" | "top4_rate" | "win_rate" | "delta">("games");
  const [unitSortDir, setUnitSortDir] = useState<SortDir>("desc");
  const [itemSortKey, setItemSortKey] = useState<"games" | "avg_placement" | "top4_rate" | "win_rate" | "delta">("games");
  const [itemSortDir, setItemSortDir] = useState<SortDir>("desc");
  const [traitSortKey, setTraitSortKey] = useState<"games" | "avg_placement" | "top4_rate" | "win_rate" | "delta">("games");
  const [traitSortDir, setTraitSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetch(backendUrl("/api/item-assets/"))
      .then((r) => (r.ok ? r.json() : { assets: {}, names: {} }))
      .then((data: { assets: Record<string, string>; names: Record<string, string> }) => {
        setItemAssets(data.assets ?? data);
        if (data.names) _itemNamesCache = data.names;
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    if (filters.length === 0) {
      setExploreData(null);
      return;
    }
    setLoading(true);
    const params = filtersToParams(filters, selectedVersion, traitData);
    params.set("include_trait_stats", "1");
    fetch(backendUrl(`/api/explore/?${params.toString()}`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setExploreData)
      .catch(() => setExploreData(null))
      .finally(() => setLoading(false));
  }, [filters, selectedVersion, traitData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleVersionChange(v: string) {
    setSelectedVersion(v);
    const p = new URLSearchParams(searchParams.toString());
    if (v) p.set("game_version", v);
    else p.delete("game_version");
    router.push(`/explore?${p.toString()}`);
  }

  function handleSearchSelect(item: SearchResultItem) {
    if (item.kind === "unit") {
      const already = filters.some(
        (f) => f.kind === "unit" && f.unit === item.unit.unit_name
      );
      if (already) return;
      setFilters((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "unit",
          unit: item.unit.unit_name,
          excluded: item.excluded ?? false,
          starLevel: 0,
          itemCount: -1,
          requiredCount: 1,
        },
      ]);
    } else if (item.kind === "unit_count") {
      // Increase the required count on the existing unit filter
      setFilters((prev) =>
        prev.map((f) =>
          f.kind === "unit" && !f.excluded && f.unit === item.unit.unit_name
            ? { ...f, requiredCount: item.count }
            : f
        )
      );
    } else if (item.kind === "trait") {
      const isExcluded = item.excluded ?? false;
      const already = filters.some(
        (f) => f.kind === "trait" && f.trait === item.trait && f.excluded === isExcluded
      );
      if (already) return;
      const bps = traitData[item.trait]?.breakpoints ?? [];
      setFilters((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "trait",
          trait: item.trait,
          breakpoint: bps.length > 0 ? bps[0] : 1,
          maxBreakpoint: bps.length > 0 ? bps[bps.length - 1] : 1,
          excluded: isExcluded,
        },
      ]);
    } else if (item.kind === "item") {
      const already = filters.some(
        (f) => f.kind === "item" && f.item === item.item && f.excluded === (item.excluded ?? false)
      );
      if (already) return;
      setFilters((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "item",
          item: item.item,
          excluded: item.excluded ?? false,
          holder: "",
        },
      ]);
    } else if (item.kind === "level") {
      const already = filters.some(
        (f) => f.kind === "level" && f.level === item.level
      );
      if (already) return;
      setFilters((prev) => [
        ...prev,
        { id: uid(), kind: "level", level: item.level },
      ]);
    }
  }

  function updateFilter(id: string, updated: Filter) {
    setFilters((prev) => prev.map((f) => (f.id === id ? updated : f)));
  }

  function removeFilter(id: string) {
    setFilters((prev) => prev.filter((f) => f.id !== id));
  }

  function addUnitFilterDirect(unitName: string) {
    const already = filters.some((f) => f.kind === "unit" && f.unit === unitName);
    if (already) return;
    setFilters((prev) => [
      ...prev,
      { id: uid(), kind: "unit", unit: unitName, excluded: false, starLevel: 0, itemCount: -1, requiredCount: 1 },
    ]);
  }

  function addItemFilterDirect(unitName: string, itemName: string) {
    const already = filters.some(
      (f) => f.kind === "item" && f.item === itemName && !f.excluded && f.holder === unitName
    );
    if (!already) {
      setFilters((prev) => [
        ...prev,
        { id: uid(), kind: "item", item: itemName, excluded: false, holder: unitName },
      ]);
    }
  }

  function handleUnitSort(key: typeof unitSortKey) {
    if (unitSortKey === key) setUnitSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setUnitSortKey(key);
      setUnitSortDir(key === "avg_placement" || key === "delta" ? "asc" : "desc");
    }
  }

  function handleItemSort(key: typeof itemSortKey) {
    if (itemSortKey === key) setItemSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setItemSortKey(key);
      setItemSortDir(key === "avg_placement" || key === "delta" ? "asc" : "desc");
    }
  }

  function handleTraitSort(key: typeof traitSortKey) {
    if (traitSortKey === key) setTraitSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setTraitSortKey(key);
      setTraitSortDir(key === "avg_placement" || key === "delta" ? "asc" : "desc");
    }
  }

  function rateColor(v: number) {
    if (v >= 0.6) return "text-yellow-400 font-semibold";
    if (v >= 0.45) return "text-green-400";
    if (v >= 0.3) return "text-tft-text";
    return "text-red-400";
  }

  function winRateColor(v: number) {
    if (v >= 0.2) return "text-yellow-400 font-semibold";
    if (v >= 0.12) return "text-green-400";
    if (v >= 0.08) return "text-tft-text";
    return "text-red-400";
  }

  const requiredUnits = useMemo(
    () =>
      new Set(
        filters
          .filter((f): f is UnitFilter => f.kind === "unit" && !f.excluded)
          .map((f) => f.unit)
      ),
    [filters]
  );

  const unitMap = useMemo(
    () => Object.fromEntries(units.map((u) => [u.unit_name, u])),
    [units]
  );

  // Merge unit_count_stats into unit_stats as normal rows with a count label
  const sortedUnits = useMemo(() => {
    if (!exploreData) return [];
    const rows: (UnitResult & { countLabel?: string })[] = [
      ...exploreData.unit_stats
        .filter((row) => !requiredUnits.has(row.unit_name) && row.games >= minFrequency),
      ...(exploreData.unit_count_stats ?? [])
        .filter((row) => row.games >= minFrequency)
        .map((row) => ({
          unit_name: row.unit_name,
          games: row.games,
          avg_placement: row.avg_placement,
          top4_rate: row.top4_rate,
          win_rate: row.win_rate,
          delta: row.delta,
          countLabel: row.count === 2 ? "2nd" : row.count === 3 ? "3rd" : `${row.count}th`,
        })),
    ];
    return rows.sort((a, b) => {
      const av = a[unitSortKey],
        bv = b[unitSortKey];
      return unitSortDir === "asc" ? av - bv : bv - av;
    });
  }, [exploreData, unitSortKey, unitSortDir, requiredUnits, minFrequency]);

  const sortedItems = useMemo(() => {
    if (!exploreData) return [];
    return [...exploreData.item_stats]
      .filter((row) => row.games >= minFrequency)
      .sort((a, b) => {
        const av = a[itemSortKey],
          bv = b[itemSortKey];
        return itemSortDir === "asc" ? av - bv : bv - av;
      });
  }, [exploreData, itemSortKey, itemSortDir, minFrequency]);

  const sortedTraits = useMemo(() => {
    if (!exploreData?.trait_stats) return [];
    return [...exploreData.trait_stats]
      .filter((row) => row.games >= minFrequency)
      .sort((a, b) => {
        const av = a[traitSortKey],
          bv = b[traitSortKey];
        return traitSortDir === "asc" ? av - bv : bv - av;
      });
  }, [exploreData, traitSortKey, traitSortDir, minFrequency]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Data Explorer</h1>
        <p className="text-tft-muted text-sm mt-1">
          Filter comps by conditions and see how each unit and item performs within the matching
          games.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar: filters */}
        <div className="w-72 flex-shrink-0 space-y-4">
          <div className="bg-tft-surface border border-tft-border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-tft-text text-sm font-semibold">Filters</p>
              {filters.length > 0 && (
                <button
                  onClick={() => setFilters([])}
                  className="text-tft-muted hover:text-red-400 text-xs transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Unified search */}
            <UnifiedSearch units={units} traitData={traitData} itemAssets={itemAssets} filters={filters} onSelect={handleSearchSelect} />

            {/* Version filter */}
            {versions.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-tft-muted text-xs font-medium">Version</label>
                <select
                  value={selectedVersion}
                  onChange={(e) => handleVersionChange(e.target.value)}
                  className="w-full bg-tft-bg border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent"
                >
                  <option value="">All versions</option>
                  {versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Min frequency */}
            <div className="space-y-1.5">
              <label className="text-tft-muted text-xs font-medium">Min frequency</label>
              <input
                type="number"
                min={0}
                value={minFrequency || ""}
                placeholder="0"
                onChange={(e) => setMinFrequency(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-tft-bg border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent tabular-nums"
              />
            </div>

            {/* Selected filter chips — vertical stack */}
            {filters.length > 0 && (
              <div className="flex flex-col gap-2 pt-1">
                {filters.map((f) =>
                  f.kind === "unit" ? (
                    <UnitFilterChip
                      key={f.id}
                      filter={f}
                      unitInfo={unitMap[f.unit]}
                      onUpdate={(updated) => updateFilter(f.id, updated)}
                      onRemove={() => removeFilter(f.id)}
                    />
                  ) : f.kind === "trait" ? (
                    <TraitFilterChip
                      key={f.id}
                      filter={f}
                      traitData={traitData}
                      onUpdate={(updated) => updateFilter(f.id, updated)}
                      onRemove={() => removeFilter(f.id)}
                    />
                  ) : f.kind === "item" ? (
                    <ItemFilterChip
                      key={f.id}
                      filter={f}
                      itemAssets={itemAssets}
                      units={units}
                      onUpdate={(updated) => updateFilter(f.id, updated)}
                      onRemove={() => removeFilter(f.id)}
                    />
                  ) : (
                    <LevelFilterChip
                      key={f.id}
                      filter={f}
                      onUpdate={(updated) => updateFilter(f.id, updated)}
                      onRemove={() => removeFilter(f.id)}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: results */}
        <div className="flex-1 min-w-0 space-y-4">
      {/* Empty state */}
      {filters.length === 0 && (
        <div className="text-center py-20 text-tft-muted">
          <p className="text-lg">Add a filter to start exploring.</p>
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-tft-muted text-sm py-4">Loading...</p>}

      {/* Results */}
      {!loading && exploreData && (
        <div className="space-y-4">
          {/* Base stats card */}
          <div className="bg-tft-surface border border-tft-border rounded-xl px-5 py-4 flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Matching comps</p>
              <p className="text-2xl font-bold text-tft-text tabular-nums">
                {exploreData.base_games.toLocaleString("en-US")}
              </p>
            </div>
            <div className="w-px h-10 bg-tft-border" />
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Avg placement</p>
              <p
                className={`text-2xl font-bold tabular-nums ${placementColor(
                  exploreData.base_avg_placement
                )}`}
              >
                {exploreData.base_avg_placement.toFixed(2)}
              </p>
            </div>
            <div className="w-px h-10 bg-tft-border" />
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Top 4 %</p>
              <p className={`text-2xl font-bold tabular-nums ${rateColor(exploreData.base_top4_rate)}`}>
                {(exploreData.base_top4_rate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="w-px h-10 bg-tft-border" />
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Win %</p>
              <p className={`text-2xl font-bold tabular-nums ${winRateColor(exploreData.base_win_rate)}`}>
                {(exploreData.base_win_rate * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-tft-border">
            {(["units", "items", "traits"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-tft-accent text-tft-text"
                    : "border-transparent text-tft-muted hover:text-tft-text"
                }`}
              >
                {tab === "units" ? "Units" : tab === "items" ? "Items on Units" : "Traits"}
              </button>
            ))}
          </div>

          {/* Units table */}
          {activeTab === "units" && (
            <div className="overflow-x-auto rounded-xl border border-tft-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-tft-surface border-b border-tft-border">
                    <th className="px-4 py-3 text-left font-semibold text-tft-muted">Unit</th>
                    {(["games", "avg_placement", "top4_rate", "win_rate", "delta"] as const).map((col) => (
                      <th
                        key={col}
                        onClick={() => handleUnitSort(col)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${
                          unitSortKey === col ? "text-tft-gold" : "text-tft-muted"
                        }`}
                      >
                        {col === "games"
                          ? "Frequency"
                          : col === "avg_placement"
                          ? "Avg Place"
                          : col === "top4_rate"
                          ? "Top 4 %"
                          : col === "win_rate"
                          ? "Win %"
                          : "Delta"}
                        <SortIcon active={unitSortKey === col} dir={unitSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedUnits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-tft-muted">
                        No data.
                      </td>
                    </tr>
                  ) : (
                    sortedUnits.map((row, i) => {
                      const unitInfo = unitMap[row.unit_name];
                      const isCountRow = !!row.countLabel;
                      return (
                        <tr
                          key={isCountRow ? `count-${row.unit_name}-${row.countLabel}` : row.unit_name}
                          onClick={() => {
                            if (isCountRow) {
                              // Parse count from label and set on the filter
                              const count = row.countLabel === "2nd" ? 2 : row.countLabel === "3rd" ? 3 : 1;
                              setFilters((prev) =>
                                prev.map((f) =>
                                  f.kind === "unit" && !f.excluded && f.unit === row.unit_name
                                    ? { ...f, requiredCount: count }
                                    : f
                                )
                              );
                            } else {
                              addUnitFilterDirect(row.unit_name);
                            }
                          }}
                          title={isCountRow ? `Set ${formatUnit(row.unit_name)} to ${row.countLabel}` : `Include ${formatUnit(row.unit_name)} in comp`}
                          className={`border-b border-tft-border cursor-pointer hover:bg-tft-hover transition-colors ${
                            i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={unitImageUrl(row.unit_name)}
                                alt={formatUnit(row.unit_name)}
                                width={32}
                                height={32}
                                className={`w-8 h-8 rounded-lg object-cover border-2 ${costBorderColor(
                                  unitInfo?.cost ?? 0
                                )}`}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                              {isCountRow && (
                                <span className="text-amber-400 text-xs font-bold">{row.countLabel}</span>
                              )}
                              <span className="text-tft-text">{formatUnit(row.unit_name)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-tft-muted tabular-nums">
                            {row.games}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums ${placementColor(
                              row.avg_placement
                            )}`}
                          >
                            {row.avg_placement.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${rateColor(row.top4_rate)}`}>
                            {(row.top4_rate * 100).toFixed(1)}%
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${winRateColor(row.win_rate)}`}>
                            {(row.win_rate * 100).toFixed(1)}%
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deltaColor(
                              row.delta
                            )}`}
                          >
                            {row.delta > 0 ? "+" : ""}
                            {row.delta.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                Click a unit to add it as a filter.
              </p>
            </div>
          )}

          {/* Items table */}
          {activeTab === "items" && (
            <div className="overflow-x-auto rounded-xl border border-tft-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-tft-surface border-b border-tft-border">
                    <th className="px-4 py-3 text-left font-semibold text-tft-muted">Unit</th>
                    <th className="px-4 py-3 text-left font-semibold text-tft-muted">Item</th>
                    {(["games", "avg_placement", "top4_rate", "win_rate", "delta"] as const).map((col) => (
                      <th
                        key={col}
                        onClick={() => handleItemSort(col)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${
                          itemSortKey === col ? "text-tft-gold" : "text-tft-muted"
                        }`}
                      >
                        {col === "games"
                          ? "Frequency"
                          : col === "avg_placement"
                          ? "Avg Place"
                          : col === "top4_rate"
                          ? "Top 4 %"
                          : col === "win_rate"
                          ? "Win %"
                          : "Delta"}
                        <SortIcon active={itemSortKey === col} dir={itemSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-tft-muted">
                        No data.
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((row, i) => {
                      const unitInfo = unitMap[row.unit_name];
                      const imgUrl = itemAssets[row.item_name];
                      return (
                        <tr
                          key={`${row.unit_name}::${row.item_name}`}
                          onClick={() => addItemFilterDirect(row.unit_name, row.item_name)}
                          title={`Add ${formatUnit(row.unit_name)} as filter`}
                          className={`border-b border-tft-border cursor-pointer hover:bg-tft-hover transition-colors ${
                            i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={unitImageUrl(row.unit_name)}
                                alt={formatUnit(row.unit_name)}
                                width={28}
                                height={28}
                                className={`w-7 h-7 rounded-lg object-cover border-2 ${costBorderColor(
                                  unitInfo?.cost ?? 0
                                )}`}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                              <span className="text-tft-text">{formatUnit(row.unit_name)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {imgUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imgUrl}
                                  alt={formatItemName(row.item_name)}
                                  width={24}
                                  height={24}
                                  className="w-6 h-6 rounded object-cover flex-shrink-0"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-6 h-6 rounded bg-tft-surface border border-tft-border flex-shrink-0" />
                              )}
                              <span className="text-tft-text">{formatItemName(row.item_name)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-tft-muted tabular-nums">
                            {row.games}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums ${placementColor(
                              row.avg_placement
                            )}`}
                          >
                            {row.avg_placement.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${rateColor(row.top4_rate)}`}>
                            {(row.top4_rate * 100).toFixed(1)}%
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${winRateColor(row.win_rate)}`}>
                            {(row.win_rate * 100).toFixed(1)}%
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deltaColor(
                              row.delta
                            )}`}
                          >
                            {row.delta > 0 ? "+" : ""}
                            {row.delta.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                Click a row to add that unit as a filter.
              </p>
            </div>
          )}

          {/* Traits table */}
          {activeTab === "traits" && (
            <div className="overflow-x-auto rounded-xl border border-tft-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-tft-surface border-b border-tft-border">
                    <th className="px-4 py-3 text-left font-semibold text-tft-muted">Trait</th>
                    {(["games", "avg_placement", "top4_rate", "win_rate", "delta"] as const).map((col) => (
                      <th
                        key={col}
                        onClick={() => handleTraitSort(col)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${
                          traitSortKey === col ? "text-tft-gold" : "text-tft-muted"
                        }`}
                      >
                        {col === "games"
                          ? "Frequency"
                          : col === "avg_placement"
                          ? "Avg Place"
                          : col === "top4_rate"
                          ? "Top 4 %"
                          : col === "win_rate"
                          ? "Win %"
                          : "Delta"}
                        <SortIcon active={traitSortKey === col} dir={traitSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTraits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-tft-muted">
                        No data.
                      </td>
                    </tr>
                  ) : (
                    sortedTraits.map((row, i) => {
                      const traitInfo = traitData[row.trait_name];
                      const breakpoints = traitInfo?.breakpoints ?? [];
                      const style = TRAIT_TIER_STYLES[row.tier] ?? TRAIT_TIER_STYLES[1];
                      const bpValue = breakpoints[row.tier - 1] ?? row.num_units;
                      return (
                        <tr
                          key={`${row.trait_name}-${row.tier}`}
                          onClick={() => {
                            const already = filters.some(
                              (f) => f.kind === "trait" && f.trait === row.trait_name && !f.excluded
                            );
                            if (!already) {
                              setFilters((prev) => [
                                ...prev,
                                {
                                  id: uid(),
                                  kind: "trait",
                                  trait: row.trait_name,
                                  breakpoint: bpValue,
                                  maxBreakpoint: (traitData[row.trait_name]?.breakpoints ?? []).slice(-1)[0] ?? bpValue,
                                  excluded: false,
                                },
                              ]);
                            }
                          }}
                          title={`Filter by ${row.trait_name} (${bpValue})`}
                          className={`border-b border-tft-border cursor-pointer hover:bg-tft-hover transition-colors ${
                            i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-0.5 pl-0.5 pr-1.5 h-6 rounded border text-xs font-bold ${style.chip}`}
                              >
                                {traitInfo?.icon && (
                                  <span
                                    className="w-4 h-4 shrink-0 inline-block"
                                    style={{
                                      backgroundColor: style.iconColor,
                                      WebkitMaskImage: `url(${traitInfo.icon})`,
                                      maskImage: `url(${traitInfo.icon})`,
                                      WebkitMaskSize: "contain",
                                      maskSize: "contain",
                                      WebkitMaskRepeat: "no-repeat",
                                      maskRepeat: "no-repeat",
                                      WebkitMaskPosition: "center",
                                      maskPosition: "center",
                                    }}
                                  />
                                )}
                                <span className={style.num}>{bpValue}</span>
                              </span>
                              <span className="text-tft-text">{row.trait_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-tft-muted tabular-nums">
                            {row.games}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums ${placementColor(
                              row.avg_placement
                            )}`}
                          >
                            {row.avg_placement.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${rateColor(row.top4_rate)}`}>
                            {(row.top4_rate * 100).toFixed(1)}%
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${winRateColor(row.win_rate)}`}>
                            {(row.win_rate * 100).toFixed(1)}%
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deltaColor(
                              row.delta
                            )}`}
                          >
                            {row.delta > 0 ? "+" : ""}
                            {row.delta.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                Click a trait to add it as a filter.
              </p>
            </div>
          )}
        </div>
      )}

      {/* No results state */}
      {!loading && exploreData && exploreData.base_games === 0 && (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-10 text-center text-tft-muted text-sm">
          No comps matched these conditions. Try relaxing some filters.
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
