"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backendUrl } from "@/lib/backend";

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

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

const STAR_LABELS: Record<number, string> = {
  1: "★",
  2: "★★",
  3: "★★★",
};

function costBorderColor(cost: number): string {
  return COST_COLORS[cost] ?? "border-gray-500";
}

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

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
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

function formatItemName(itemName: string): string {
  return itemName.replace(/^TFT\d*_Item_/, "").replace(/([A-Z])/g, " $1").trim();
}

function StarStatsTable({ stats }: { stats: StarStat[] }) {
  return (
    <table className="text-sm w-auto">
      <thead>
        <tr className="text-tft-muted text-xs">
          <th className="text-left font-medium pr-8 pb-1.5">Stars</th>
          <th className="text-right font-medium pr-8 pb-1.5">Frequency</th>
          <th className="text-right font-medium pr-8 pb-1.5">Avg Place</th>
          <th className="text-right font-medium pr-8 pb-1.5">Top 4 %</th>
          <th className="text-right font-medium pb-1.5">Win %</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => {
          const label = STAR_LABELS[s.star_level] ?? `${s.star_level}★`;
          return (
            <tr key={s.star_level} className="border-t border-tft-border/50">
              <td className={`pr-8 py-1.5 font-bold tracking-wider ${starLabelColor(s.star_level)}`}>
                {label}
              </td>
              <td className="pr-8 py-1.5 text-right text-tft-muted tabular-nums">
                {s.games}
              </td>
              <td className={`pr-8 py-1.5 text-right tabular-nums ${placementColor(s.avg_placement)}`}>
                {s.avg_placement.toFixed(2)}
              </td>
              <td className={`pr-8 py-1.5 text-right tabular-nums ${top4RateColor(s.top4_rate)}`}>
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
  );
}

function ItemStatsTable({ stats, itemAssets }: { stats: ItemStat[]; itemAssets: Record<string, string> }) {
  return (
    <table className="text-sm w-auto">
      <thead>
        <tr className="text-tft-muted text-xs">
          <th className="text-left font-medium pr-8 pb-1.5">Item</th>
          <th className="text-right font-medium pr-8 pb-1.5">Frequency</th>
          <th className="text-right font-medium pr-8 pb-1.5">Avg Place</th>
          <th className="text-right font-medium pr-8 pb-1.5">Top 4 %</th>
          <th className="text-right font-medium pb-1.5">Win %</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => {
          const imgUrl = itemAssets[s.item_name];
          return (
            <tr key={s.item_name} className="border-t border-tft-border/50">
              <td className="pr-8 py-1.5">
                <div className="flex items-center gap-2">
                  {imgUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imgUrl}
                      alt={formatItemName(s.item_name)}
                      width={24}
                      height={24}
                      className="w-6 h-6 rounded object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-6 h-6 rounded bg-tft-surface border border-tft-border flex-shrink-0" />
                  )}
                  <span className="text-tft-text">{formatItemName(s.item_name)}</span>
                </div>
              </td>
              <td className="pr-8 py-1.5 text-right text-tft-muted tabular-nums">{s.games}</td>
              <td className={`pr-8 py-1.5 text-right tabular-nums ${placementColor(s.avg_placement)}`}>
                {s.avg_placement.toFixed(2)}
              </td>
              <td className={`pr-8 py-1.5 text-right tabular-nums ${top4RateColor(s.top4_rate)}`}>
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
  );
}

export default function StatsTable({
  data,
  versions,
  selectedVersion,
  matchesAnalyzed,
}: {
  data: UnitStat[];
  versions: string[];
  selectedVersion: string;
  matchesAnalyzed: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
    fetch(backendUrl("/api/item-assets/"))
      .then((r) => r.ok ? r.json() : {})
      .then(setItemAssets)
      .catch(() => {});
  }, []);

  function handleVersionChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) {
      params.set("game_version", v);
    } else {
      params.delete("game_version");
    }
    router.push(`/?${params.toString()}`);
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
      const versionParam = selectedVersion ? `?game_version=${encodeURIComponent(selectedVersion)}` : "";
      const url = backendUrl(`/api/unit-stats/${encodeURIComponent(unitName)}/star-stats/${versionParam}`);
      const res = await fetch(url);
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
      <div className="flex flex-wrap gap-3 items-center">
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
          placeholder="Search unit..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-48"
        />
        <input
          type="number"
          placeholder="Min games"
          value={minGames}
          onChange={(e) => setMinGames(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-32"
          min={0}
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent"
        >
          <option value="">All tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
          <option value="4">Tier 4</option>
          <option value="5">Tier 5</option>
        </select>
        <span className="text-tft-muted text-sm ml-auto">
          {matchesAnalyzed.toLocaleString("en-US")} games analyzed
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-tft-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-tft-surface border-b border-tft-border">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key, col.defaultDir)}
                  className={`
                    px-4 py-3 text-left font-semibold cursor-pointer select-none
                    text-tft-muted hover:text-tft-text transition-colors
                    ${sortKey === col.key ? "text-tft-gold" : ""}
                    ${col.key === "unit_name" ? "w-48" : ""}
                  `}
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
              {/* expand chevron column */}
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
                        border-b border-tft-border transition-colors cursor-pointer
                        hover:bg-tft-hover
                        ${isExpanded ? "bg-tft-hover" : i % 2 === 0 ? "bg-tft-bg" : "bg-tft-surface/40"}
                        ${isExpanded ? "" : "last:border-0"}
                      `}
                    >
                      <td className="px-4 py-3 font-medium text-tft-text">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={unitImageUrl(row.unit_name)}
                          alt={formatUnit(row.unit_name)}
                          width={40}
                          height={40}
                          className={`w-10 h-10 object-cover rounded-lg border-2 ${costBorderColor(row.cost)}`}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      </td>
                      <td className="px-4 py-3 text-tft-text tabular-nums">
                        {row.games}
                      </td>
                      <td className={`px-4 py-3 tabular-nums ${placementColor(row.avg_placement)}`}>
                        {row.avg_placement.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 tabular-nums ${top4RateColor(row.top4_rate)}`}>
                        {(row.top4_rate * 100).toFixed(1)}%
                      </td>
                      <td className={`px-4 py-3 tabular-nums ${winRateColor(row.win_rate)}`}>
                        {(row.win_rate * 100).toFixed(1)}%
                      </td>
                      <td className="px-2 py-3 text-tft-muted text-center">
                        <span className={`inline-block transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>
                          ›
                        </span>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        key={`${row.unit_name}-expanded`}
                        className="border-b border-tft-border bg-tft-surface/60"
                      >
                        <td colSpan={6} className="px-6 py-4">
                          <div className="flex items-center gap-2 mb-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={unitImageUrl(row.unit_name)}
                              alt={formatUnit(row.unit_name)}
                              width={24}
                              height={24}
                              className={`w-6 h-6 object-cover rounded border ${costBorderColor(row.cost)}`}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                            <span className="text-tft-text font-semibold text-sm">
                              {formatUnit(row.unit_name)}
                            </span>
                          </div>

                          {isLoading && (
                            <p className="text-tft-muted text-sm">Loading...</p>
                          )}

                          {!isLoading && detail && (
                            <div className="flex flex-wrap gap-10">
                              <div>
                                <p className="text-tft-muted text-xs mb-2">Star Level</p>
                                {detail.star_stats.length > 0
                                  ? <StarStatsTable stats={detail.star_stats} />
                                  : <p className="text-tft-muted text-sm">No data.</p>
                                }
                              </div>
                              {detail.item_stats.length > 0 && (
                                <div>
                                  <p className="text-tft-muted text-xs mb-2">Top Items</p>
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
