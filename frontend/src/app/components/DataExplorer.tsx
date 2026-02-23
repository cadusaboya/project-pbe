"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backendUrl } from "@/lib/backend";
import { UnitStat } from "./StatsTable";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConditionType = "require_unit" | "ban_unit" | "require_item_on_unit" | "exclude_item" | "player_level";

interface Condition {
  id: string;
  type: ConditionType;
  unit?: string;
  item?: string;
  level?: number;
}

interface UnitResult {
  unit_name: string;
  games: number;
  avg_placement: number;
  delta: number;
}

interface ItemResult {
  unit_name: string;
  item_name: string;
  games: number;
  avg_placement: number;
  delta: number;
}

interface ExploreResponse {
  base_games: number;
  base_avg_placement: number;
  unit_stats: UnitResult[];
  item_stats: ItemResult[];
}

type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

function formatItemName(name: string): string {
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

function uid() {
  return Math.random().toString(36).slice(2);
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  require_unit: "Include unit",
  ban_unit: "Exclude unit",
  require_item_on_unit: "Unit has item",
  exclude_item: "Ban item from comp",
  player_level: "Player level",
};

const CONDITION_COLORS: Record<ConditionType, string> = {
  require_unit: "border-green-600 bg-green-950/40",
  ban_unit: "border-red-700 bg-red-950/40",
  require_item_on_unit: "border-blue-600 bg-blue-950/30",
  exclude_item: "border-orange-600 bg-orange-950/30",
  player_level: "border-tft-accent bg-tft-accent/10",
};

function conditionLabel(c: Condition): string {
  switch (c.type) {
    case "require_unit": return `✓ ${formatUnit(c.unit!)}`;
    case "ban_unit": return `✗ ${formatUnit(c.unit!)}`;
    case "require_item_on_unit": return `${formatUnit(c.unit!)} + ${formatItemName(c.item!)}`;
    case "exclude_item": return `No ${formatItemName(c.item!)}`;
    case "player_level": return `Level ${c.level}`;
  }
}

// ── Searchable unit dropdown ───────────────────────────────────────────────────

function UnitPicker({
  units,
  value,
  onChange,
  onCommit,
  placeholder = "Select unit...",
}: {
  units: UnitStat[];
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  placeholder?: string;
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlightedIndex]) { const v = filtered[highlightedIndex].unit_name; onChange(v); setSearch(""); setOpen(false); onCommit?.(v); } }
    else if (e.key === "Escape") { setOpen(false); }
  }

  const selected = units.find((u) => u.unit_name === value) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-1.5 text-sm hover:border-tft-accent transition-colors min-w-[160px] text-left"
      >
        {selected ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={unitImageUrl(selected.unit_name)} alt="" width={20} height={20}
              className={`w-5 h-5 rounded border ${costBorderColor(selected.cost)}`}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            <span className="text-tft-text flex-1">{formatUnit(selected.unit_name)}</span>
          </>
        ) : (
          <span className="text-tft-muted">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-56 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input ref={inputRef} type="text" placeholder="Search..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded px-2 py-1 text-sm focus:outline-none focus:border-tft-accent" />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.map((u, i) => (
              <button key={u.unit_name} onClick={() => { onChange(u.unit_name); setSearch(""); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={unitImageUrl(u.unit_name)} alt="" width={20} height={20}
                  className={`w-5 h-5 rounded border ${costBorderColor(u.cost)}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                <span className="text-tft-text text-sm">{formatUnit(u.unit_name)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-3 text-tft-muted text-sm text-center">No units found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Searchable item dropdown ───────────────────────────────────────────────────

function ItemPicker({
  itemAssets,
  value,
  onChange,
  onCommit,
  placeholder = "Select item...",
}: {
  itemAssets: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  placeholder?: string;
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

  const allItems = useMemo(() => Object.keys(itemAssets).sort(), [itemAssets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? allItems.filter((i) => formatItemName(i).toLowerCase().includes(q) || i.toLowerCase().includes(q))
      : allItems;
    return list.slice(0, 24);
  }, [allItems, search]);

  useEffect(() => { setHighlightedIndex(0); }, [filtered]);
  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlightedIndex]) { const v = filtered[highlightedIndex]; onChange(v); setSearch(""); setOpen(false); onCommit?.(v); } }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-1.5 text-sm hover:border-tft-accent transition-colors min-w-[160px] text-left"
      >
        {value ? (
          <>
            {itemAssets[value] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={itemAssets[value]} alt="" width={20} height={20}
                className="w-5 h-5 rounded object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
            <span className="text-tft-text flex-1">{formatItemName(value)}</span>
          </>
        ) : (
          <span className="text-tft-muted">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-64 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input ref={inputRef} type="text" placeholder="Search item..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded px-2 py-1 text-sm focus:outline-none focus:border-tft-accent" />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.map((item, i) => (
              <button key={item} onClick={() => { onChange(item); setSearch(""); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"}`}>
                {itemAssets[item] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={itemAssets[item]} alt="" width={20} height={20}
                    className="w-5 h-5 rounded object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                )}
                <span className="text-tft-text text-sm">{formatItemName(item)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-3 text-tft-muted text-sm text-center">No items found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable table helpers ─────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-tft-muted opacity-40 select-none">↕</span>;
  return <span className="ml-1 text-tft-gold select-none">{dir === "asc" ? "↑" : "↓"}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DataExplorer({
  units,
  versions,
  selectedVersion: initialVersion,
}: {
  units: UnitStat[];
  versions: string[];
  selectedVersion: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters
  const [selectedVersion, setSelectedVersion] = useState(initialVersion);
  const [conditions, setConditions] = useState<Condition[]>([]);

  // Pending condition builder state
  const [pendingType, setPendingType] = useState<ConditionType>("require_unit");
  const [pendingUnit, setPendingUnit] = useState("");
  const [pendingItem, setPendingItem] = useState("");
  const [pendingLevel, setPendingLevel] = useState<number>(8);

  // Data
  const [exploreData, setExploreData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [itemAssets, setItemAssets] = useState<Record<string, string>>({});

  // Table
  const [activeTab, setActiveTab] = useState<"units" | "items">("units");
  const [unitSortKey, setUnitSortKey] = useState<"games" | "avg_placement" | "delta">("games");
  const [unitSortDir, setUnitSortDir] = useState<SortDir>("desc");
  const [itemSortKey, setItemSortKey] = useState<"games" | "avg_placement" | "delta">("games");
  const [itemSortDir, setItemSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetch(backendUrl("/api/item-assets/"))
      .then((r) => (r.ok ? r.json() : {}))
      .then(setItemAssets)
      .catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    if (conditions.length === 0) {
      setExploreData(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedVersion) params.set("game_version", selectedVersion);
    for (const c of conditions) {
      if (c.type === "require_unit" && c.unit) params.append("require_unit", c.unit);
      if (c.type === "ban_unit" && c.unit) params.append("ban_unit", c.unit);
      if (c.type === "require_item_on_unit" && c.unit && c.item)
        params.append("require_item_on_unit", `${c.unit}::${c.item}`);
      if (c.type === "exclude_item" && c.item) params.append("exclude_item", c.item);
      if (c.type === "player_level" && c.level != null) params.append("player_level", String(c.level));
    }
    fetch(backendUrl(`/api/explore/?${params.toString()}`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setExploreData)
      .catch(() => setExploreData(null))
      .finally(() => setLoading(false));
  }, [conditions, selectedVersion]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleVersionChange(v: string) {
    setSelectedVersion(v);
    const p = new URLSearchParams(searchParams.toString());
    if (v) p.set("game_version", v); else p.delete("game_version");
    router.push(`/explore?${p.toString()}`);
  }

  function handleUnitCommit(v: string) {
    if (pendingType === "require_unit" || pendingType === "ban_unit") {
      setConditions((prev) => [...prev, { id: uid(), type: pendingType, unit: v }]);
      setPendingUnit("");
    }
    // require_item_on_unit: just set unit, user still needs to pick item
  }

  function handleItemCommit(v: string) {
    if (pendingType === "exclude_item") {
      setConditions((prev) => [...prev, { id: uid(), type: "exclude_item", item: v }]);
      setPendingItem("");
    } else if (pendingType === "require_item_on_unit" && pendingUnit) {
      setConditions((prev) => [...prev, { id: uid(), type: "require_item_on_unit", unit: pendingUnit, item: v }]);
      setPendingUnit("");
      setPendingItem("");
    }
  }

  function addCondition() {
    if (pendingType === "player_level") {
      const isDuplicate = conditions.some((c) => c.type === "player_level" && c.level === pendingLevel);
      if (!isDuplicate) setConditions((prev) => [...prev, { id: uid(), type: "player_level", level: pendingLevel }]);
      return;
    }
    const needsUnit = pendingType !== "exclude_item";
    const needsItem = pendingType === "require_item_on_unit" || pendingType === "exclude_item";
    if (needsUnit && !pendingUnit) return;
    if (needsItem && !pendingItem) return;
    setConditions((prev) => [
      ...prev,
      { id: uid(), type: pendingType, unit: pendingUnit || undefined, item: pendingItem || undefined },
    ]);
    setPendingUnit("");
    setPendingItem("");
  }

  function removeCondition(id: string) {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  }

  function addConditionDirect(condition: Omit<Condition, "id">) {
    const isDuplicate = conditions.some(
      (c) => c.type === condition.type && c.unit === condition.unit && c.item === condition.item
    );
    if (isDuplicate) return;
    setConditions((prev) => [...prev, { ...condition, id: uid() }]);
  }

  function handleUnitSort(key: typeof unitSortKey) {
    if (unitSortKey === key) setUnitSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setUnitSortKey(key); setUnitSortDir(key === "avg_placement" || key === "delta" ? "asc" : "desc"); }
  }

  function handleItemSort(key: typeof itemSortKey) {
    if (itemSortKey === key) setItemSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setItemSortKey(key); setItemSortDir(key === "avg_placement" || key === "delta" ? "asc" : "desc"); }
  }

  // Sets of already-required unit/item combos — used to filter & deduplicate
  const requiredUnits = useMemo(
    () => new Set(conditions.filter((c) => c.type === "require_unit").map((c) => c.unit!)),
    [conditions]
  );
  const requiredItemPairs = useMemo(
    () =>
      new Set(
        conditions
          .filter((c) => c.type === "require_item_on_unit" && c.unit && c.item)
          .map((c) => `${c.unit}::${c.item}`)
      ),
    [conditions]
  );

  const sortedUnits = useMemo(() => {
    if (!exploreData) return [];
    return [...exploreData.unit_stats]
      .filter((row) => !requiredUnits.has(row.unit_name))
      .sort((a, b) => {
        const av = a[unitSortKey], bv = b[unitSortKey];
        return unitSortDir === "asc" ? av - bv : bv - av;
      });
  }, [exploreData, unitSortKey, unitSortDir, requiredUnits]);

  const sortedItems = useMemo(() => {
    if (!exploreData) return [];
    return [...exploreData.item_stats]
      .filter((row) => !requiredItemPairs.has(`${row.unit_name}::${row.item_name}`))
      .sort((a, b) => {
        const av = a[itemSortKey], bv = b[itemSortKey];
        return itemSortDir === "asc" ? av - bv : bv - av;
      });
  }, [exploreData, itemSortKey, itemSortDir, requiredItemPairs]);

  const unitMap = useMemo(
    () => Object.fromEntries(units.map((u) => [u.unit_name, u])),
    [units]
  );

  const needsUnit = pendingType !== "exclude_item" && pendingType !== "player_level";
  const needsItem = pendingType === "require_item_on_unit" || pendingType === "exclude_item";
  const needsLevel = pendingType === "player_level";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Data Explorer</h1>
        <p className="text-tft-muted text-sm mt-1">
          Filter comps by conditions and see how each unit and item performs within the matching games.
        </p>
      </div>

      {/* Version filter */}
      <div className="flex flex-wrap gap-3 items-center">
        {versions.length > 0 && (
          <select value={selectedVersion} onChange={(e) => handleVersionChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent">
            <option value="">All versions</option>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>

      {/* Condition builder */}
      <div className="bg-tft-surface border border-tft-border rounded-xl p-4 space-y-3">
        <p className="text-tft-text text-sm font-semibold">Add condition</p>
        <div className="flex flex-wrap gap-2 items-end">
          {/* Type */}
          <select value={pendingType} onChange={(e) => { setPendingType(e.target.value as ConditionType); setPendingUnit(""); setPendingItem(""); }}
            className="bg-tft-bg border border-tft-border text-tft-text rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-tft-accent">
            {(Object.entries(CONDITION_LABELS) as [ConditionType, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {/* Unit picker */}
          {needsUnit && (
            <UnitPicker units={units} value={pendingUnit} onChange={setPendingUnit} onCommit={handleUnitCommit} />
          )}

          {/* Item picker */}
          {needsItem && (
            <ItemPicker itemAssets={itemAssets} value={pendingItem} onChange={setPendingItem} onCommit={handleItemCommit} />
          )}

          {/* Level picker */}
          {needsLevel && (
            <select
              value={pendingLevel}
              onChange={(e) => setPendingLevel(Number(e.target.value))}
              className="bg-tft-bg border border-tft-border text-tft-text rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-tft-accent"
            >
              {Array.from({ length: 11 }, (_, i) => i + 1).map((lvl) => (
                <option key={lvl} value={lvl}>Level {lvl}</option>
              ))}
            </select>
          )}

          <button
            onClick={addCondition}
            disabled={
              (needsUnit && !pendingUnit) || (needsItem && !pendingItem)
            }
            className="px-4 py-1.5 bg-tft-accent text-white text-sm rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Add
          </button>
        </div>

        {/* Active conditions */}
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {conditions.map((c) => (
              <div key={c.id}
                className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 text-sm ${CONDITION_COLORS[c.type]}`}>
                {/* Unit image */}
                {c.unit && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={unitImageUrl(c.unit)} alt="" width={18} height={18}
                    className={`w-4.5 h-4.5 rounded border ${costBorderColor(unitMap[c.unit]?.cost ?? 0)}`}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                )}
                {/* Item image */}
                {c.item && itemAssets[c.item] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={itemAssets[c.item]} alt="" width={18} height={18}
                    className="w-4.5 h-4.5 rounded object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                )}
                <span className="text-tft-text font-medium">{conditionLabel(c)}</span>
                <button onClick={() => removeCondition(c.id)}
                  className="text-tft-muted hover:text-tft-text text-base leading-none ml-0.5">×</button>
              </div>
            ))}
            <button onClick={() => setConditions([])}
              className="text-tft-muted hover:text-red-400 text-xs px-2 py-1.5 transition-colors">
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {conditions.length === 0 && (
        <div className="text-center py-20 text-tft-muted">
          <p className="text-lg">Add at least one condition above to start exploring.</p>
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-tft-muted text-sm py-4">Loading...</p>}

      {/* Results */}
      {!loading && exploreData && (
        <div className="space-y-4">
          {/* Base stats card */}
          <div className="bg-tft-surface border border-tft-border rounded-xl px-5 py-4 flex items-center gap-6">
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Matching comps</p>
              <p className="text-2xl font-bold text-tft-text tabular-nums">
                {exploreData.base_games.toLocaleString("en-US")}
              </p>
            </div>
            <div className="w-px h-10 bg-tft-border" />
            <div>
              <p className="text-tft-muted text-xs uppercase tracking-wide">Avg placement</p>
              <p className={`text-2xl font-bold tabular-nums ${placementColor(exploreData.base_avg_placement)}`}>
                {exploreData.base_avg_placement.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-tft-border">
            {(["units", "items"] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-tft-accent text-tft-text"
                    : "border-transparent text-tft-muted hover:text-tft-text"
                }`}>
                {tab === "units" ? "Units" : "Items on Units"}
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
                    {(["games", "avg_placement", "delta"] as const).map((col) => (
                      <th key={col} onClick={() => handleUnitSort(col)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${unitSortKey === col ? "text-tft-gold" : "text-tft-muted"}`}>
                        {col === "games" ? "Frequency" : col === "avg_placement" ? "Avg Place" : "Delta"}
                        <SortIcon active={unitSortKey === col} dir={unitSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedUnits.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-tft-muted">No data.</td></tr>
                  ) : sortedUnits.map((row, i) => {
                    const unitInfo = unitMap[row.unit_name];
                    return (
                      <tr key={row.unit_name}
                        onClick={() => addConditionDirect({ type: "require_unit", unit: row.unit_name })}
                        title={`Include ${formatUnit(row.unit_name)} in comp`}
                        className={`border-b border-tft-border cursor-pointer hover:bg-tft-hover transition-colors ${i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={unitImageUrl(row.unit_name)} alt={formatUnit(row.unit_name)}
                              width={32} height={32}
                              className={`w-8 h-8 rounded-lg object-cover border-2 ${costBorderColor(unitInfo?.cost ?? 0)}`}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            <span className="text-tft-text">{formatUnit(row.unit_name)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-tft-muted tabular-nums">{row.games}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${placementColor(row.avg_placement)}`}>
                          {row.avg_placement.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deltaColor(row.delta)}`}>
                          {row.delta > 0 ? "+" : ""}{row.delta.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                Click a unit to add it as a required condition.
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
                    {(["games", "avg_placement", "delta"] as const).map((col) => (
                      <th key={col} onClick={() => handleItemSort(col)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${itemSortKey === col ? "text-tft-gold" : "text-tft-muted"}`}>
                        {col === "games" ? "Frequency" : col === "avg_placement" ? "Avg Place" : "Delta"}
                        <SortIcon active={itemSortKey === col} dir={itemSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-tft-muted">No data.</td></tr>
                  ) : sortedItems.map((row, i) => {
                    const unitInfo = unitMap[row.unit_name];
                    const imgUrl = itemAssets[row.item_name];
                    return (
                      <tr key={`${row.unit_name}::${row.item_name}`}
                        onClick={() => addConditionDirect({ type: "require_item_on_unit", unit: row.unit_name, item: row.item_name })}
                        title={`Require ${formatItemName(row.item_name)} on ${formatUnit(row.unit_name)}`}
                        className={`border-b border-tft-border cursor-pointer hover:bg-tft-hover transition-colors ${i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={unitImageUrl(row.unit_name)} alt={formatUnit(row.unit_name)}
                              width={28} height={28}
                              className={`w-7 h-7 rounded-lg object-cover border-2 ${costBorderColor(unitInfo?.cost ?? 0)}`}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            <span className="text-tft-text">{formatUnit(row.unit_name)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {imgUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={imgUrl} alt={formatItemName(row.item_name)} width={24} height={24}
                                className="w-6 h-6 rounded object-cover flex-shrink-0"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className="w-6 h-6 rounded bg-tft-surface border border-tft-border flex-shrink-0" />
                            )}
                            <span className="text-tft-text">{formatItemName(row.item_name)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-tft-muted tabular-nums">{row.games}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${placementColor(row.avg_placement)}`}>
                          {row.avg_placement.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deltaColor(row.delta)}`}>
                          {row.delta > 0 ? "+" : ""}{row.delta.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                Click a row to require that item on that unit.
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
  );
}
