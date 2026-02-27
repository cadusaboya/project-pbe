"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UnitImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";

interface CompUnit {
  character_id: string;
  cost: number;
}

interface FlexCombo {
  units: CompUnit[];
  comps: number;
  avg_placement: number;
}

interface FlexPick {
  character_id: string;
  cost: number;
  rate: number;
  games: number;
  avg_placement: number;
}

interface CoreTrait {
  name: string;
  units: number;
}

export interface CompStat {
  name?: string;
  target_level?: number;
  core_size?: number;
  flex_slots?: number;
  core_traits?: CoreTrait[];
  core_units: CompUnit[];
  comps: number;
  avg_placement: number;
  win_rate?: number;
  top4_rate?: number;
  flex_combos: FlexCombo[];
  flex_picks?: FlexPick[];
  // Constraint fields
  excluded_units?: string[];
  required_traits?: string[];
  excluded_unit_counts?: Record<string, number>;
  required_unit_star_levels?: Record<string, number>;
  required_unit_item_counts?: Record<string, number>;
  required_trait_breakpoints?: Record<string, number>;
  excluded_traits?: Record<string, number>;
}

type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

function formatTrait(name: string): string {
  return name.replace(/^TFT\d+_/, "").replace(/^Set\d+_/, "");
}

function avpTextColor(avp: number): string {
  if (avp <= 3.2) return "text-emerald-400";
  if (avp <= 3.7) return "text-teal-400";
  if (avp <= 4.0) return "text-green-300";
  if (avp <= 4.4) return "text-amber-300/90";
  if (avp <= 4.8) return "text-orange-400/80";
  return "text-rose-400/80";
}

function compTier(avp: number): { label: string; color: string; bg: string } {
  if (avp < 3.7) return { label: "S", color: "text-red-400", bg: "bg-red-500/20 border-red-500/40" };
  if (avp < 4.0) return { label: "A", color: "text-orange-400", bg: "bg-orange-500/20 border-orange-500/40" };
  if (avp < 4.4) return { label: "B", color: "text-yellow-400", bg: "bg-yellow-500/20 border-yellow-500/40" };
  if (avp < 4.8) return { label: "C", color: "text-lime-400", bg: "bg-lime-500/20 border-lime-500/40" };
  return { label: "D", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/30" };
}


function UnitChip({ unit, size = 48 }: { unit: CompUnit; size?: number }) {
  return (
    <UnitImage
      characterId={unit.character_id}
      cost={unit.cost}
      size={size}
      className="transition-transform hover:scale-110 hover:z-10"
    />
  );
}

function StatBadge({
  value,
  label,
  valueClass = "text-tft-text",
}: {
  value: string;
  label: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col items-center px-2">
      <div className={`text-sm font-bold tabular-nums ${valueClass}`}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-tft-muted">{label}</div>
    </div>
  );
}

function MetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-tft-border bg-tft-surface text-[11px] text-tft-muted leading-none">
      {children}
    </span>
  );
}

function CompCard({ comp, onExplore }: { comp: CompStat; onExplore?: (comp: CompStat) => void }) {
  const [expanded, setExpanded] = useState(false);
  const winRate = (comp.win_rate ?? 0) * 100;
  const top4Rate = (comp.top4_rate ?? 0) * 100;
  const flexPicks = comp.flex_picks ?? [];

  const hasMeta =
    comp.name ||
    comp.target_level ||
    comp.core_size ||
    comp.flex_slots ||
    (comp.core_traits && comp.core_traits.length > 0);

  return (
    <div
      className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden"
    >
      {/* Clickable header */}
      <div
        className="px-4 py-3.5 cursor-pointer select-none hover:bg-tft-hover/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Row 1: name + meta tags + explore button */}
        {(hasMeta || onExplore) && (
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            {comp.name && (
              <span className="text-base font-bold text-tft-text leading-none">{comp.name}</span>
            )}
            {comp.target_level && <MetaTag>Lv {comp.target_level}</MetaTag>}
            {(comp.core_size != null || comp.flex_slots != null) && (
              <MetaTag>
                Core {comp.core_size ?? comp.core_units.length}
                {comp.flex_slots != null ? ` + ${comp.flex_slots} flex` : ""}
              </MetaTag>
            )}
            {comp.core_traits?.map((t) => (
              <MetaTag key={t.name}>
                {formatTrait(t.name)} {t.units}
              </MetaTag>
            ))}
            {onExplore && (
              <button
                onClick={(e) => { e.stopPropagation(); onExplore(comp); }}
                className="ml-auto text-xs text-tft-muted hover:text-tft-accent border border-tft-border hover:border-tft-accent/50 rounded px-2 py-0.5 transition-colors shrink-0"
              >
                Explore →
              </button>
            )}
          </div>
        )}

        {/* Row 2: units + stats */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {/* Units section — fills remaining space */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 flex-wrap">
            {/* Core units */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
              {comp.core_units.map((u) => (
                <UnitChip key={u.character_id} unit={u} />
              ))}
            </div>

            {/* Top board flex inline */}
            {comp.flex_combos[0] && (
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-px h-8 bg-tft-border/50 mx-0.5 sm:mx-1" />
                <span className="text-[9px] uppercase tracking-widest text-tft-muted/50 mr-0.5">
                  flex
                </span>
                {comp.flex_combos[0].units.map((u) => (
                  <UnitChip key={`suggest-${u.character_id}`} unit={u} size={40} />
                ))}
              </div>
            )}
          </div>

          {/* Stats — responsive: full width on mobile, fixed on desktop */}
          <div className="flex items-center gap-1 shrink-0 justify-between sm:justify-end sm:w-[340px]">
            {/* Tier badge */}
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md border text-xs font-bold ${compTier(comp.avg_placement).color} ${compTier(comp.avg_placement).bg} mr-1`}>
              {compTier(comp.avg_placement).label}
            </span>
            {/* AVP */}
            <div className="flex flex-col items-center w-12 sm:w-14">
              <div className={`text-base sm:text-xl font-semibold tabular-nums leading-none ${avpTextColor(comp.avg_placement)}`}>
                {comp.avg_placement.toFixed(2)}
              </div>
              <div className="text-[8px] sm:text-[9px] uppercase tracking-wider text-tft-muted mt-0.5">AVP</div>
            </div>
            <div className="w-px h-6 bg-tft-border/40" />
            <div className="w-10 sm:w-14"><StatBadge value={String(comp.comps)} label="Freq" /></div>
            <div className="w-px h-6 bg-tft-border/40" />
            <div className="w-10 sm:w-14"><StatBadge value={`${winRate.toFixed(1)}%`} label="Win" /></div>
            <div className="w-px h-6 bg-tft-border/40" />
            <div className="w-10 sm:w-14"><StatBadge value={`${top4Rate.toFixed(1)}%`} label="Top 4" /></div>
            <span className="text-tft-muted text-[11px] w-3 shrink-0 ml-1">
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded: flex picks + flex combos */}
      {expanded && (
        <div className="border-t border-tft-border bg-black/20">
          {flexPicks.length === 0 && comp.flex_combos.length === 0 ? (
            <p className="px-4 py-4 text-tft-muted text-sm">
              No flex data found for this core.
            </p>
          ) : (
            <>
              {/* Section 1: Flex Picks */}
              {flexPicks.length > 0 && (
                <div className="px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-tft-muted/70 mb-2 font-medium">
                    Flex Picks
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {flexPicks.slice(0, 10).map((pick) => (
                      <div
                        key={pick.character_id}
                        className="flex items-center gap-1.5 bg-tft-surface/80 border border-tft-border/60 rounded-lg px-2 py-1.5"
                      >
                        <UnitChip
                          unit={{ character_id: pick.character_id, cost: pick.cost }}
                          size={40}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-tft-text tabular-nums">
                            {Math.round(pick.rate * 100)}%
                          </span>
                          <span className={`text-[9px] tabular-nums ${avpTextColor(pick.avg_placement)}`}>
                            {pick.avg_placement.toFixed(2)} AVP
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: Top Boards */}
              {comp.flex_combos.length > 0 && (
                <div className={flexPicks.length > 0 ? "border-t border-tft-border/40" : ""}>
                  <div className="px-4 pt-3 pb-1">
                    <div className="text-[10px] uppercase tracking-wider text-tft-muted/70 mb-1 font-medium">
                      Most Common Boards
                    </div>
                  </div>
                  <div className="divide-y divide-tft-border/40">
                    {comp.flex_combos.map((flex, idx) => (
                      <div key={idx} className="px-4 py-2.5 flex items-center gap-3 hover:bg-tft-hover/30 transition-colors">
                        <span className="text-[11px] text-tft-muted w-8 shrink-0 tabular-nums font-medium">
                          #{idx + 1}
                        </span>
                        <div className="flex gap-1">
                          {flex.units.map((u) => (
                            <UnitChip key={`${idx}-${u.character_id}`} unit={u} size={36} />
                          ))}
                        </div>
                        <div className="ml-auto flex items-center gap-3 shrink-0">
                          <StatBadge value={String(flex.comps)} label="Freq" />
                          <div className="w-px h-5 bg-tft-border/40" />
                          <div className="flex flex-col items-center px-1">
                            <div className={`text-base font-bold tabular-nums ${avpTextColor(flex.avg_placement)}`}>
                              {flex.avg_placement.toFixed(2)}
                            </div>
                            <div className="text-[9px] uppercase tracking-wider text-tft-muted">AVP</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CompsList({
  data,
  selectedVersion,
  basePath = "/comps",
  showCompMeta = true,
  showHiddenFilters = false,
  selectedCoreSizes = "4,5,6",
  selectedMinOccurrences = "100",
  traitData = {},
  totalComps,
  server,
}: {
  data: CompStat[];
  selectedVersion: string;
  basePath?: string;
  showCompMeta?: boolean;
  showHiddenFilters?: boolean;
  selectedCoreSizes?: string;
  selectedMinOccurrences?: string;
  traitData?: TraitData;
  totalComps?: number;
  server: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  type SortKey = "avg_placement" | "comps" | "win_rate" | "top4_rate";
  const [sort, setSort] = useState<SortKey>("avg_placement");
  const [sortAsc, setSortAsc] = useState(true);
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  function handleSort(key: SortKey) {
    if (sort === key) setSortAsc((v) => !v);
    else { setSort(key); setSortAsc(key === "avg_placement"); }
  }

  function pushParams(next: URLSearchParams) {
    router.push(`${basePath}?${next.toString()}`);
  }

  function handleCoreSizesChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("core_sizes", v);
    else params.delete("core_sizes");
    pushParams(params);
  }

  function handleExploreComp(comp: CompStat) {
    const params = new URLSearchParams();
    if (selectedVersion) params.set("game_version", selectedVersion);


    // Count each unit (core_units already expands multi-copy units)
    const unitCounts = new Map<string, number>();
    for (const u of comp.core_units) {
      unitCounts.set(u.character_id, (unitCounts.get(u.character_id) ?? 0) + 1);
    }
    for (const [charId, count] of unitCounts) {
      params.append("require_unit", charId);
      if (count > 1) params.append("require_unit_count", `${charId}:${count}`);
    }

    // target_level → player_level
    if (comp.target_level) params.append("player_level", String(comp.target_level));

    // excluded_units → ban_unit
    for (const u of comp.excluded_units ?? []) {
      params.append("ban_unit", u);
    }

    // required_traits + required_trait_breakpoints → require_trait (snapped to real breakpoints)
    const breakpointTraitsLower = new Set(
      Object.keys(comp.required_trait_breakpoints ?? {}).map((t) => t.toLowerCase())
    );
    for (const t of comp.required_traits ?? []) {
      if (breakpointTraitsLower.has(t.toLowerCase())) continue;
      const bps = traitData[t]?.breakpoints ?? [];
      if (bps.length > 0) params.append("require_trait", `${t}:${Math.min(...bps)}`);
    }
    for (const [trait, minUnits] of Object.entries(comp.required_trait_breakpoints ?? {})) {
      const bps = traitData[trait]?.breakpoints ?? [];
      const validBps = bps.filter((bp) => bp <= minUnits);
      const snapped = validBps.length > 0 ? Math.max(...validBps) : bps.length > 0 ? Math.min(...bps) : minUnits;
      params.append("require_trait", `${trait}:${snapped}`);
    }

    // excluded_unit_counts → exclude_unit_count
    for (const [unit, minCount] of Object.entries(comp.excluded_unit_counts ?? {})) {
      params.append("exclude_unit_count", `${unit}:${minCount}`);
    }

    // required_unit_star_levels → require_unit_star
    for (const [unit, minStar] of Object.entries(comp.required_unit_star_levels ?? {})) {
      params.append("require_unit_star", `${unit}:${minStar}`);
    }

    // required_unit_item_counts → require_unit_item_count
    for (const [unit, minItems] of Object.entries(comp.required_unit_item_counts ?? {})) {
      params.append("require_unit_item_count", `${unit}:${minItems}`);
    }

    // excluded_traits → exclude_trait
    for (const [trait, threshold] of Object.entries(comp.excluded_traits ?? {})) {
      params.append("exclude_trait", `${trait}:${threshold}`);
    }

    router.push(`/${server.toLowerCase()}/explore?${params.toString()}`);
  }

  function handleMinOccurrencesChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    const parsed = parseInt(v, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      params.set("min_occurrences", String(parsed));
    } else {
      params.delete("min_occurrences");
    }
    pushParams(params);
  }

  // Reset visible count when filters/sort change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, sort, sortAsc, data]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

  // Auto-load more when sentinel scrolls into view
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

  const filtered = useMemo(() => {
    let rows = data.filter((comp) => comp.comps > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((comp) => {
        if (comp.name && comp.name.toLowerCase().includes(q)) return true;
        return comp.core_units.some((u) => u.character_id.toLowerCase().includes(q));
      });
    }
    return [...rows].sort((a, b) => {
      let av: number, bv: number;
      if (sort === "avg_placement") { av = a.avg_placement; bv = b.avg_placement; }
      else if (sort === "comps") { av = a.comps; bv = b.comps; }
      else if (sort === "win_rate") { av = a.win_rate ?? 0; bv = b.win_rate ?? 0; }
      else { av = a.top4_rate ?? 0; bv = b.top4_rate ?? 0; }
      return sortAsc ? av - bv : bv - av;
    });
  }, [data, search, sort, sortAsc]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {showHiddenFilters && (
          <select
            value={selectedCoreSizes}
            onChange={(e) => handleCoreSizesChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent transition-colors"
          >
            <option value="2">Core 2</option>
            <option value="3">Core 3</option>
            <option value="2,3">Core 2/3</option>
            <option value="2,3,4">Core 2/3/4</option>
            <option value="4,5,6">Core 4/5/6</option>
            <option value="4">Core 4</option>
            <option value="5">Core 5</option>
            <option value="6">Core 6</option>
            <option value="4,5">Core 4/5</option>
            <option value="5,6">Core 5/6</option>
          </select>
        )}

        {showHiddenFilters && (
          <input
            type="number"
            min={1}
            value={selectedMinOccurrences}
            onChange={(e) => handleMinOccurrencesChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-36 transition-colors"
            placeholder="Min occurrences"
            title="Min occurrences"
          />
        )}

        <div className="relative flex-1 min-w-[120px] max-w-[220px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tft-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search comp or unit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-full transition-colors"
          />
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 bg-tft-surface border border-tft-border rounded-lg p-0.5">
          {(
            [
              { key: "avg_placement", label: "AVP" },
              { key: "comps",         label: "Freq" },
              { key: "win_rate",      label: "Win%" },
              { key: "top4_rate",     label: "Top 4%" },
            ] as { key: SortKey; label: string }[]
          ).map(({ key, label }) => {
            const active = sort === key;
            const arrow = active ? (sortAsc ? " ↑" : " ↓") : "";
            return (
              <button
                key={key}
                onClick={() => handleSort(key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  active
                    ? "bg-tft-gold/20 text-tft-gold shadow-sm"
                    : "text-tft-muted hover:text-tft-text"
                }`}
              >
                {label}{arrow}
              </button>
            );
          })}
        </div>

        <span className="text-tft-muted text-sm ml-auto tabular-nums">
          {totalComps != null && totalComps > 0
            ? `${totalComps.toLocaleString()} comps analyzed`
            : `${filtered.length} comps`}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No compositions found.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.slice(0, visibleCount).map((comp, i) => (
            <CompCard
              key={`${i}-${comp.core_units.map((u) => u.character_id).join("|")}`}
              onExplore={handleExploreComp}
              comp={{
                ...comp,
                target_level: showCompMeta ? comp.target_level : undefined,
                core_size: showCompMeta ? comp.core_size : undefined,
                flex_slots: showCompMeta ? comp.flex_slots : undefined,
                core_traits: showCompMeta ? comp.core_traits : undefined,
              }}
            />
          ))}
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="py-4 text-center text-tft-muted text-sm">
              Loading more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
