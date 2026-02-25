"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backendUrl } from "@/lib/backend";
import { UnitStat } from "./StatsTable";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit, costBorderColor } from "@/lib/tftUtils";

interface ItemStat {
  item_name: string;
  games: number;
  avg_placement: number;
  delta: number;
  top4_rate: number;
  win_rate: number;
}

interface ItemStatsResponse {
  unit: string;
  base_games: number;
  base_avg_placement: number;
  items: ItemStat[];
}

const MAX_SELECTED_ITEMS = 2;

// ── helpers ──────────────────────────────────────────────────────────────────

let _itemNamesCache: Record<string, string> = {};

function formatItemName(itemName: string): string {
  if (_itemNamesCache[itemName]) return _itemNamesCache[itemName];
  return itemName.replace(/^TFT\d*_Item_/, "").replace(/([A-Z])/g, " $1").trim();
}

function placementColor(placement: number): string {
  if (placement <= 2) return "text-yellow-400 font-semibold";
  if (placement <= 4) return "text-green-400";
  if (placement <= 6) return "text-tft-text";
  return "text-red-400";
}

function deltaColor(delta: number): string {
  if (delta < -0.5) return "text-green-400 font-bold";
  if (delta < 0) return "text-green-400";
  if (delta === 0) return "text-tft-muted";
  if (delta <= 0.5) return "text-red-400";
  return "text-red-400 font-bold";
}

// ── Champion selector ────────────────────────────────────────────────────────

function ChampionSelector({
  units,
  selectedUnit,
  onSelect,
}: {
  units: UnitStat[];
  selectedUnit: UnitStat | null;
  onSelect: (unit: UnitStat | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return units.slice(0, 24);
    const q = search.trim().toLowerCase();
    return units
      .filter(
        (u) =>
          u.unit_name.toLowerCase().includes(q) ||
          formatUnit(u.unit_name).toLowerCase().includes(q)
      )
      .slice(0, 24);
  }, [units, search]);

  // Reset highlight when results change
  useEffect(() => { setHighlightedIndex(0); }, [filtered]);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSelect(unit: UnitStat) {
    onSelect(unit);
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
    <div ref={containerRef} className="relative">
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-2 hover:border-tft-accent transition-colors min-w-[150px] sm:min-w-[200px] text-left"
      >
        {selectedUnit ? (
          <>
            <UnitImage
              characterId={selectedUnit.unit_name}
              cost={selectedUnit.cost}
              size={24}
              borderWidth={1}
            />
            <span className="text-tft-text text-sm flex-1">
              {formatUnit(selectedUnit.unit_name)}
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(null);
                setSearch("");
              }}
              className="text-tft-muted hover:text-tft-text text-base leading-none ml-1"
            >
              ×
            </span>
          </>
        ) : (
          <span className="text-tft-muted text-sm">Select champion...</span>
        )}
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search champion..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
              onKeyDown={handleKeyDown}
              className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded px-2 py-1.5 text-sm focus:outline-none focus:border-tft-accent"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto">
            {filtered.map((unit, i) => (
              <button
                key={unit.unit_name}
                onClick={() => handleSelect(unit)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"
                }`}
              >
                <UnitImage
                  characterId={unit.unit_name}
                  cost={unit.cost}
                  size={24}
                  borderWidth={1}
                />
                <span className="text-tft-text text-sm">{formatUnit(unit.unit_name)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-tft-muted text-sm text-center">
                No champions found.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Item chip ────────────────────────────────────────────────────────────────

function ItemChip({
  itemName,
  itemAssets,
  onRemove,
}: {
  itemName: string;
  itemAssets: Record<string, string>;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-tft-bg border border-tft-accent rounded-lg px-3 py-2">
      <ItemImage
        itemId={itemName}
        itemAssets={itemAssets}
        size={20}
      />
      <span className="text-tft-text text-sm font-medium">
        {formatItemName(itemName)}
      </span>
      <button
        onClick={onRemove}
        className="text-tft-muted hover:text-tft-text ml-1 text-base leading-none"
        title="Remove item"
      >
        ×
      </button>
    </div>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = "games" | "avg_placement" | "delta" | "top4_rate" | "win_rate";
type SortDir = "asc" | "desc";

const SORT_DEFAULTS: Record<SortKey, SortDir> = {
  games: "desc",
  avg_placement: "asc",
  delta: "asc",
  top4_rate: "desc",
  win_rate: "desc",
};

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active)
    return <span className="ml-1 text-tft-muted opacity-40 select-none">↕</span>;
  return (
    <span className="ml-1 text-tft-gold select-none">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function sortItems(items: ItemStat[], key: SortKey, dir: SortDir): ItemStat[] {
  return [...items].sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return dir === "asc" ? av - bv : bv - av;
  });
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ItemsExplorer({
  units,
  versions,
  selectedVersion: initialVersion,
  server,
}: {
  units: UnitStat[];
  versions: string[];
  selectedVersion: string;
  server: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedUnit, setSelectedUnit] = useState<UnitStat | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(initialVersion);
  const [minGames, setMinGames] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemData, setItemData] = useState<ItemStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [itemAssets, setItemAssets] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("games");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetch(backendUrl(`/api/item-assets/?server=${encodeURIComponent(server)}`))
      .then((r) => (r.ok ? r.json() : { assets: {}, names: {} }))
      .then((data: { assets: Record<string, string>; names: Record<string, string> }) => {
        setItemAssets(data.assets ?? data);
        if (data.names) _itemNamesCache = data.names;
      })
      .catch(() => {});
  }, [server]);

  useEffect(() => {
    if (!selectedUnit) {
      setItemData(null);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams({ unit: selectedUnit.unit_name });
    if (selectedVersion) params.set("game_version", selectedVersion);
    if (minGames) params.set("min_games", minGames);
    selectedItems.forEach((item) => params.append("selected_item", item));
    params.set("server", server);

    fetch(backendUrl(`/api/item-stats/?${params.toString()}`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setItemData)
      .catch(() => setItemData(null))
      .finally(() => setLoading(false));
  }, [selectedUnit, selectedVersion, minGames, selectedItems, server]);

  function handleVersionChange(v: string) {
    setSelectedVersion(v);
    setSelectedItems([]);
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("game_version", v);
    else params.delete("game_version");
    router.push(`/items?${params.toString()}`);
  }

  function handleUnitSelect(unit: UnitStat | null) {
    setSelectedUnit(unit);
    setSelectedItems([]);
    setItemData(null);
  }

  function handleItemClick(itemName: string) {
    if (selectedItems.length >= MAX_SELECTED_ITEMS) return;
    setSelectedItems((prev) => [...prev, itemName]);
  }

  function removeItem(itemName: string) {
    setSelectedItems((prev) => prev.filter((i) => i !== itemName));
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SORT_DEFAULTS[key]);
    }
  }

  const canSelectMore = selectedItems.length < MAX_SELECTED_ITEMS;
  const displayedItems = sortItems(itemData?.items ?? [], sortKey, sortDir);

  // Build a human-readable "context" label for the header subtitle
  function baseLabel(): React.ReactNode {
    if (!itemData || loading) return null;
    if (selectedItems.length === 0) {
      return (
        <>
          Base:{" "}
          <span className={`font-semibold ${placementColor(itemData.base_avg_placement)}`}>
            {itemData.base_avg_placement.toFixed(2)}
          </span>{" "}
          avg placement ({itemData.base_games} games)
        </>
      );
    }
    return (
      <>
        With {selectedItems.map(formatItemName).join(" + ")}:{" "}
        <span className={`font-semibold ${placementColor(itemData.base_avg_placement)}`}>
          {itemData.base_avg_placement.toFixed(2)}
        </span>{" "}
        avg placement ({itemData.base_games} games)
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Item Explorer</h1>
        <p className="text-tft-muted text-sm mt-1">
          Select a champion to see how items affect their average placement.
          Click items to explore 2- and 3-item combinations.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <ChampionSelector
          units={units}
          selectedUnit={selectedUnit}
          onSelect={handleUnitSelect}
        />
        {versions.length > 0 && (
          <select
            value={selectedVersion}
            onChange={(e) => handleVersionChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent"
          >
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          placeholder="Min games"
          value={minGames}
          onChange={(e) => {
            setMinGames(e.target.value);
            setSelectedItems([]);
          }}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-32"
          min={0}
        />
      </div>

      {/* Empty state */}
      {!selectedUnit && (
        <div className="text-center py-24 text-tft-muted">
          <p className="text-lg">Select a champion above to see item stats.</p>
        </div>
      )}

      {/* Content */}
      {selectedUnit && (
        <div className="space-y-4">
          {/* Champion + base stats header */}
          <div className="flex flex-wrap items-center gap-4 bg-tft-surface border border-tft-border rounded-xl px-5 py-4">
            <UnitImage
              characterId={selectedUnit.unit_name}
              cost={selectedUnit.cost}
              size={56}
            />
            <div>
              <h2 className="text-xl font-bold text-tft-text">
                {formatUnit(selectedUnit.unit_name)}
              </h2>
              <p className="text-tft-muted text-sm mt-0.5">{baseLabel()}</p>
            </div>

            {/* Selected item chips */}
            {selectedItems.length > 0 && (
              <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
                {selectedItems.map((item, idx) => (
                  <div key={item} className="flex items-center gap-1">
                    {idx > 0 && (
                      <span className="text-tft-muted text-xs">+</span>
                    )}
                    <ItemChip
                      itemName={item}
                      itemAssets={itemAssets}
                      onRemove={() => removeItem(item)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <p className="text-tft-muted text-sm py-4">Loading...</p>
          )}

          {/* Items table */}
          {!loading && itemData && displayedItems.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-tft-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-tft-surface border-b border-tft-border">
                    <th className="px-4 py-3 text-left font-semibold text-tft-muted">
                      {selectedItems.length > 0 ? "Add item" : "Item"}
                    </th>
                    {(
                      [
                        { key: "games", label: "Frequency" },
                        { key: "avg_placement", label: "Avg Place" },
                        { key: "delta", label: "Delta" },
                        { key: "top4_rate", label: "Top 4%" },
                        { key: "win_rate", label: "Win%" },
                      ] as { key: SortKey; label: string }[]
                    ).map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-tft-text transition-colors ${
                          sortKey === col.key ? "text-tft-gold" : "text-tft-muted"
                        }`}
                      >
                        {col.label}
                        <SortIcon active={sortKey === col.key} dir={sortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item, i) => (
                    <tr
                      key={item.item_name}
                      onClick={() => canSelectMore && handleItemClick(item.item_name)}
                      className={`
                        border-b border-tft-border transition-colors
                        ${canSelectMore ? "cursor-pointer hover:bg-tft-hover" : ""}
                        ${i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"}
                      `}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ItemImage
                            itemId={item.item_name}
                            itemAssets={itemAssets}
                            size={28}
                          />
                          <span className="text-tft-text">
                            {formatItemName(item.item_name)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-tft-muted tabular-nums">
                        {item.games}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${placementColor(item.avg_placement)}`}
                      >
                        {item.avg_placement.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-semibold ${deltaColor(item.delta)}`}
                      >
                        {item.delta > 0 ? "+" : ""}
                        {item.delta.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-tft-text">
                        {(item.top4_rate * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-tft-text">
                        {(item.win_rate * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-tft-muted text-xs px-4 py-2 border-t border-tft-border">
                {canSelectMore
                  ? `Click an item to lock it in and explore combinations (${MAX_SELECTED_ITEMS - selectedItems.length} slot${MAX_SELECTED_ITEMS - selectedItems.length !== 1 ? "s" : ""} remaining).`
                  : "Maximum items selected. Remove one to explore further."}
              </p>
            </div>
          )}

          {!loading && itemData && displayedItems.length === 0 && (
            <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-10 text-center text-tft-muted text-sm">
              No item data found for this champion
              {selectedItems.length > 0 && (
                <>
                  {" "}with{" "}
                  <span className="text-tft-text">
                    {selectedItems.map(formatItemName).join(" + ")}
                  </span>
                </>
              )}
              {minGames && ` above ${minGames} games`}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
