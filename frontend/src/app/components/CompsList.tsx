"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface CompUnit {
  character_id: string;
  cost: number;
}

interface FlexCombo {
  units: CompUnit[];
  comps: number;
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

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

function costBorderColor(cost: number): string {
  return COST_COLORS[cost] ?? "border-gray-500";
}

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

function formatTrait(name: string): string {
  return name.replace(/^TFT\d+_/, "").replace(/^Set\d+_/, "");
}

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

function avpTextColor(avp: number): string {
  if (avp <= 3.5) return "text-green-400";
  if (avp <= 4.5) return "text-yellow-400";
  return "text-red-400";
}


function UnitChip({ unit, size = 44 }: { unit: CompUnit; size?: number }) {
  const dim = size === 44 ? "w-11 h-11" : "w-9 h-9";
  return (
    <div
      className={`${dim} rounded-lg border-2 ${costBorderColor(unit.cost)} overflow-hidden shrink-0`}
      title={formatUnit(unit.character_id)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={size}
        height={size}
        className={`${dim} object-cover`}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    </div>
  );
}

function StatBlock({
  value,
  label,
  valueClass = "text-tft-text",
  large = false,
}: {
  value: string;
  label: string;
  valueClass?: string;
  large?: boolean;
}) {
  return (
    <div className="text-right leading-none shrink-0">
      <div className={`${large ? "text-2xl font-extrabold" : "text-sm font-semibold"} tabular-nums ${valueClass}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-tft-muted mt-1">{label}</div>
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
  const suggestedFlex = comp.flex_combos[0];
  const winRate = (comp.win_rate ?? 0) * 100;
  const top4Rate = (comp.top4_rate ?? 0) * 100;

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
        className="px-4 py-3.5 cursor-pointer select-none hover:bg-tft-hover transition-colors"
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Core units */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {comp.core_units.map((u) => (
              <UnitChip key={u.character_id} unit={u} />
            ))}
          </div>

          {/* Flex suggestion */}
          {suggestedFlex && (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex flex-col items-center px-0.5 select-none">
                <span className="text-tft-muted/50 text-base leading-none">+</span>
                <span className="text-[8px] uppercase tracking-widest text-tft-muted/40 leading-none mt-0.5">
                  flex
                </span>
              </div>
              {suggestedFlex.units.map((u) => (
                <UnitChip key={`suggest-${u.character_id}`} unit={u} />
              ))}
            </div>
          )}

          {/* Stats pushed to the right */}
          <div className="ml-auto flex items-center gap-5 shrink-0">
            <StatBlock value={String(comp.comps)} label="Frequency" />
            <StatBlock value={`${winRate.toFixed(1)}%`} label="Win%" />
            <StatBlock value={`${top4Rate.toFixed(1)}%`} label="Top 4%" />
            <StatBlock
              value={comp.avg_placement.toFixed(2)}
              label="AVP"
              valueClass={avpTextColor(comp.avg_placement)}
              large
            />
            <span className="text-tft-muted text-[11px] w-3 shrink-0">
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded: flex combos */}
      {expanded && (
        <div className="border-t border-tft-border bg-black/20">
          {comp.flex_combos.length === 0 ? (
            <p className="px-4 py-4 text-tft-muted text-sm">
              No flex combos found for this core.
            </p>
          ) : (
            <div className="divide-y divide-tft-border/40">
              {comp.flex_combos.map((flex, idx) => (
                <div key={idx} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[11px] text-tft-muted w-14 shrink-0 tabular-nums">
                    #{idx + 1}
                  </span>
                  <div className="flex gap-1.5">
                    {flex.units.map((u) => (
                      <UnitChip key={`${idx}-${u.character_id}`} unit={u} size={36} />
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-4 shrink-0">
                    <StatBlock value={String(flex.comps)} label="Frequency" />
                    <StatBlock
                      value={flex.avg_placement.toFixed(2)}
                      label="AVP"
                      valueClass={avpTextColor(flex.avg_placement)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CompsList({
  data,
  versions,
  selectedVersion,
  basePath = "/comps",
  showCompMeta = true,
  showHiddenFilters = false,
  selectedCoreSizes = "4,5,6",
  selectedMinOccurrences = "100",
  traitData = {},
}: {
  data: CompStat[];
  versions: string[];
  selectedVersion: string;
  basePath?: string;
  showCompMeta?: boolean;
  showHiddenFilters?: boolean;
  selectedCoreSizes?: string;
  selectedMinOccurrences?: string;
  traitData?: TraitData;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  type SortKey = "avg_placement" | "comps" | "win_rate" | "top4_rate";
  const [sort, setSort] = useState<SortKey>("avg_placement");
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(key: SortKey) {
    if (sort === key) setSortAsc((v) => !v);
    else { setSort(key); setSortAsc(key === "avg_placement"); }
  }

  function pushParams(next: URLSearchParams) {
    router.push(`${basePath}?${next.toString()}`);
  }

  function handleVersionChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("game_version", v);
    else params.delete("game_version");
    pushParams(params);
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

    router.push(`/explore?${params.toString()}`);
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

  const filtered = useMemo(() => {
    let rows = data;
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

        {showHiddenFilters && (
          <select
            value={selectedCoreSizes}
            onChange={(e) => handleCoreSizesChange(e.target.value)}
            className="bg-tft-surface border border-tft-border text-tft-text rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent"
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
            className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-36"
            placeholder="Min occurrences"
            title="Min occurrences"
          />
        )}

        <input
          type="text"
          placeholder="Search comp or unit..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-56"
        />

        {/* Sort buttons */}
        <div className="flex items-center gap-1">
          {(
            [
              { key: "avg_placement", label: "AVP" },
              { key: "comps",         label: "Frequency" },
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
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  active
                    ? "bg-tft-accent/20 border border-tft-accent text-tft-text"
                    : "bg-tft-surface border border-tft-border text-tft-muted hover:text-tft-text hover:border-tft-accent/50"
                }`}
              >
                {label}{arrow}
              </button>
            );
          })}
        </div>

        <span className="text-tft-muted text-sm ml-auto">{filtered.length} comps</span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No compositions found.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((comp, i) => (
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
        </div>
      )}
    </div>
  );
}
