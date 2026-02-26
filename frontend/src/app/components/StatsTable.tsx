"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { backendUrl } from "@/lib/backend";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit, costBorderColor } from "@/lib/tftUtils";

export interface UnitStat {
  unit_name: string;
  cost: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
}

interface StarStat {
  star_level: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
}

interface ItemStat {
  item_name: string;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
}

interface UnitDetailStats {
  star_stats: StarStat[];
  item_stats: ItemStat[];
}

type SortKey = keyof UnitStat;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: "unit_name", label: "Unit", defaultDir: "asc" },
  { key: "games", label: "Frequency", defaultDir: "desc" },
  { key: "avg_placement", label: "Avg Place", defaultDir: "asc" },
  { key: "top4_rate", label: "Top 4 %", defaultDir: "desc" },
  { key: "win_rate", label: "Win %", defaultDir: "desc" },
];

const STAR_LABELS: Record<number, string> = {
  1: "★",
  2: "★★",
  3: "★★★",
};

function placementColor(placement: number): string {
  if (placement <= 2) return "text-yellow-400 font-semibold";
  if (placement <= 4) return "text-green-400";
  if (placement <= 6) return "text-tft-text";
  return "text-red-400";
}

function winRateColor(rate: number): string {
  if (rate > 0.2) return "text-green-400 font-semibold";
  if (rate >= 0.15) return "text-yellow-400 font-semibold";
  if (rate <= 0.05) return "text-tft-muted";
  return "text-red-400";
}

function top4RateColor(rate: number): string {
  if (rate > 0.5) return "text-green-400 font-semibold";
  if (rate < 0.3) return "text-tft-muted";
  return "text-red-400";
}

function placementBarWidth(avp: number): number {
  // Map AVP 1-8 to bar width 100%-0%
  return Math.max(0, Math.min(100, ((8 - avp) / 7) * 100));
}

function placementBarColor(avp: number): string {
  if (avp <= 3.0) return "bg-yellow-400/30";
  if (avp <= 3.5) return "bg-green-400/25";
  if (avp <= 4.0) return "bg-green-400/15";
  if (avp <= 4.5) return "bg-tft-muted/15";
  if (avp <= 5.5) return "bg-orange-400/15";
  return "bg-red-400/15";
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active)
    return (
      <span className="ml-1 text-tft-muted opacity-40 select-none">↕</span>
    );
  return (
    <span className="ml-1 text-tft-gold select-none">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function starLabelColor(starLevel: number): string {
  if (starLevel === 3) return "text-yellow-300";
  if (starLevel === 2) return "text-yellow-500";
  return "text-gray-400";
}

let _itemNamesCache: Record<string, string> = {};

function formatItemName(itemName: string): string {
  if (_itemNamesCache[itemName]) return _itemNamesCache[itemName];
  return itemName.replace(/^TFT\d*_Item_/, "").replace(/([A-Z])/g, " $1").trim();
}

function StarStatsTable({ stats }: { stats: StarStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs sm:text-sm w-auto">
        <thead>
          <tr className="text-tft-muted text-xs">
            <th className="text-left font-medium pr-3 sm:pr-8 pb-1.5">Stars</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">Freq</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">AVP</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">Top 4</th>
            <th className="text-right font-medium pb-1.5">Win</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const label = STAR_LABELS[s.star_level] ?? `${s.star_level}★`;
            return (
              <tr key={s.star_level} className="border-t border-tft-border/50">
                <td className={`pr-3 sm:pr-8 py-1.5 font-bold tracking-wider ${starLabelColor(s.star_level)}`}>
                  {label}
                </td>
                <td className="pr-3 sm:pr-8 py-1.5 text-right text-tft-muted tabular-nums">
                  {s.games}
                </td>
                <td className={`pr-3 sm:pr-8 py-1.5 text-right tabular-nums ${placementColor(s.avg_placement)}`}>
                  {s.avg_placement.toFixed(2)}
                </td>
                <td className={`pr-3 sm:pr-8 py-1.5 text-right tabular-nums ${top4RateColor(s.top4_rate)}`}>
                  {(s.top4_rate * 100).toFixed(1)}%
                </td>
                <td className={`py-1.5 text-right tabular-nums ${winRateColor(s.win_rate)}`}>
                  {(s.win_rate * 100).toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ItemStatsTable({ stats, itemAssets }: { stats: ItemStat[]; itemAssets: Record<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs sm:text-sm w-auto">
        <thead>
          <tr className="text-tft-muted text-xs">
            <th className="text-left font-medium pr-3 sm:pr-8 pb-1.5">Item</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">Freq</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">AVP</th>
            <th className="text-right font-medium pr-3 sm:pr-8 pb-1.5">Top 4</th>
            <th className="text-right font-medium pb-1.5">Win</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
              <tr key={s.item_name} className="border-t border-tft-border/50">
                <td className="pr-3 sm:pr-8 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <ItemImage
                      itemId={s.item_name}
                      itemAssets={itemAssets}
                      size={24}
                    />
                    <span className="text-tft-text">{formatItemName(s.item_name)}</span>
                  </div>
                </td>
                <td className="pr-3 sm:pr-8 py-1.5 text-right text-tft-muted tabular-nums">{s.games}</td>
                <td className={`pr-3 sm:pr-8 py-1.5 text-right tabular-nums ${placementColor(s.avg_placement)}`}>
                  {s.avg_placement.toFixed(2)}
                </td>
                <td className={`pr-3 sm:pr-8 py-1.5 text-right tabular-nums ${top4RateColor(s.top4_rate)}`}>
                  {(s.top4_rate * 100).toFixed(1)}%
                </td>
                <td className={`py-1.5 text-right tabular-nums ${winRateColor(s.win_rate)}`}>
                  {(s.win_rate * 100).toFixed(1)}%
                </td>
              </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatsTable({
  data,
  versions,
  selectedVersion,
  matchesAnalyzed,
  server,
}: {
  data: UnitStat[];
  versions: string[];
  selectedVersion: string;
  matchesAnalyzed: number;
  server: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [sortKey, setSortKey] = useState<SortKey>("avg_placement");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [minGames, setMinGames] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, UnitDetailStats>>({});
  const [loadingUnit, setLoadingUnit] = useState<string | null>(null);
  const [itemAssets, setItemAssets] = useState<Record<string, string>>({});

  useEffect(() => {
    const url = new URL(backendUrl("/api/item-assets/"));
    url.searchParams.set("server", server);
    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : { assets: {}, names: {} }))
      .then((data: { assets: Record<string, string>; names: Record<string, string> }) => {
        setItemAssets(data.assets ?? data);
        if (data.names) _itemNamesCache = data.names;
      })
      .catch(() => {});
  }, [server]);

  function handleVersionChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) {
      params.set("game_version", v);
    } else {
      params.delete("game_version");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const handleSort = (key: SortKey, defaultDir: SortDir) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  async function handleRowClick(unitName: string) {
    if (expandedUnit === unitName) {
      setExpandedUnit(null);
      return;
    }

    setExpandedUnit(unitName);

    const cacheKey = `${unitName}__${selectedVersion}`;
    if (detailCache[cacheKey]) return;

    setLoadingUnit(unitName);
    try {
      const url = new URL(backendUrl(`/api/unit-stats/${encodeURIComponent(unitName)}/star-stats/`));
      if (selectedVersion) url.searchParams.set("game_version", selectedVersion);
      url.searchParams.set("server", server);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data: UnitDetailStats = await res.json();
        setDetailCache((prev) => ({ ...prev, [cacheKey]: data }));
      } else {
        setDetailCache((prev) => ({ ...prev, [cacheKey]: { star_stats: [], item_stats: [] } }));
      }
    } catch {
      setDetailCache((prev) => ({ ...prev, [cacheKey]: { star_stats: [], item_stats: [] } }));
    } finally {
      setLoadingUnit(null);
    }
  }

  const filtered = useMemo(() => {
    let rows = [...data];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.unit_name.toLowerCase().includes(q));
    }

    const min = parseInt(minGames, 10);
    if (!isNaN(min) && min > 0) {
      rows = rows.filter((r) => r.games >= min);
    }

    const tier = parseInt(tierFilter, 10);
    if (!isNaN(tier) && tier > 0) {
      if (tier === 5) {
        rows = rows.filter((r) => r.cost >= 5);
      } else {
        rows = rows.filter((r) => r.cost === tier);
      }
    }

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sortDir === "asc" ? an - bn : bn - an;
    });

    return rows;
  }, [data, search, minGames, tierFilter, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
        {versions.length > 0 && (
          <select
            value={selectedVersion}
            onChange={(e) => handleVersionChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent transition-colors"
          >
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
        <div className="relative flex-1 min-w-[120px] max-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tft-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search unit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-full transition-colors"
          />
        </div>
        <input
          type="number"
          placeholder="Min games"
          value={minGames}
          onChange={(e) => setMinGames(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-24 sm:w-32 transition-colors"
          min={0}
        />
        <div className="flex gap-0.5 sm:gap-1 bg-tft-surface border border-tft-border rounded-lg p-0.5">
          {[
            { value: "", label: "All" },
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTierFilter(t.value)}
              className={`px-1.5 sm:px-2.5 py-1 rounded-md text-xs sm:text-sm font-medium transition-all ${
                tierFilter === t.value
                  ? "bg-tft-gold/20 text-tft-gold shadow-sm"
                  : "text-tft-muted hover:text-tft-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-tft-muted text-xs sm:text-sm ml-auto tabular-nums">
          {filtered.length} units &middot; {matchesAnalyzed.toLocaleString("en-US")} games
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-tft-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-tft-surface border-b border-tft-border">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key, col.defaultDir)}
                  className={`
                    px-4 py-3 text-left font-semibold cursor-pointer select-none
                    text-tft-muted hover:text-tft-text transition-colors
                    ${sortKey === col.key ? "text-tft-gold" : ""}
                    ${col.key === "unit_name" ? "min-w-[140px] sm:min-w-[200px]" : ""}
                  `}
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-tft-muted"
                >
                  No units found.
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => {
                const isExpanded = expandedUnit === row.unit_name;
                const isLoading = loadingUnit === row.unit_name;
                const detail = detailCache[`${row.unit_name}__${selectedVersion}`];
                return (
                  <Fragment key={row.unit_name}>
                    <tr
                      onClick={() => handleRowClick(row.unit_name)}
                      className={`
                        border-b border-tft-border/60 transition-colors cursor-pointer
                        hover:bg-tft-hover
                        ${isExpanded ? "bg-tft-hover" : i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/30"}
                        ${isExpanded ? "" : "last:border-0"}
                      `}
                    >
                      {/* Unit: image + name + cost tag */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <UnitImage
                            characterId={row.unit_name}
                            cost={row.cost}
                            size={44}
                            className="transition-transform hover:scale-110"
                          />
                          <span className="text-tft-text font-semibold text-sm truncate">
                            {formatUnit(row.unit_name)}
                          </span>
                        </div>
                      </td>
                      {/* Frequency */}
                      <td className="px-4 py-2.5 text-tft-text tabular-nums font-medium">
                        {row.games}
                      </td>
                      {/* AVP with colored bar */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`tabular-nums font-semibold ${placementColor(row.avg_placement)}`}>
                            {row.avg_placement.toFixed(2)}
                          </span>
                          <div className="w-16 h-1.5 rounded-full bg-tft-border/50 overflow-hidden hidden sm:block">
                            <div
                              className={`h-full rounded-full ${placementBarColor(row.avg_placement)} transition-all`}
                              style={{ width: `${placementBarWidth(row.avg_placement)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      {/* Top 4 */}
                      <td className={`px-4 py-2.5 tabular-nums ${top4RateColor(row.top4_rate)}`}>
                        {(row.top4_rate * 100).toFixed(1)}%
                      </td>
                      {/* Win % */}
                      <td className={`px-4 py-2.5 tabular-nums ${winRateColor(row.win_rate)}`}>
                        {(row.win_rate * 100).toFixed(1)}%
                      </td>
                      {/* Expand chevron */}
                      <td className="px-2 py-2.5 text-tft-muted text-center">
                        <span className={`inline-block transition-transform duration-200 text-lg ${isExpanded ? "rotate-90" : ""}`}>
                          ›
                        </span>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        key={`${row.unit_name}-expanded`}
                        className="border-b border-tft-border bg-tft-surface/60"
                      >
                        <td colSpan={6} className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2 mb-3">
                            <UnitImage
                              characterId={row.unit_name}
                              cost={row.cost}
                              size={28}
                              className="rounded-md"
                            />
                            <span className="text-tft-text font-semibold">
                              {formatUnit(row.unit_name)}
                            </span>
                          </div>

                          {isLoading && (
                            <div className="flex items-center gap-2 text-tft-muted text-sm">
                              <div className="w-4 h-4 border-2 border-tft-gold/30 border-t-tft-gold rounded-full animate-spin" />
                              Loading details...
                            </div>
                          )}

                          {!isLoading && detail && (
                            <div className="flex flex-wrap gap-4 sm:gap-10">
                              <div>
                                <p className="text-tft-muted text-xs mb-2 uppercase tracking-wider font-semibold">Star Level</p>
                                {detail.star_stats.length > 0
                                  ? <StarStatsTable stats={detail.star_stats} />
                                  : <p className="text-tft-muted text-sm">No data.</p>
                                }
                              </div>
                              {detail.item_stats.length > 0 && (
                                <div>
                                  <p className="text-tft-muted text-xs mb-2 uppercase tracking-wider font-semibold">Top Items</p>
                                  <ItemStatsTable stats={detail.item_stats} itemAssets={itemAssets} />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
