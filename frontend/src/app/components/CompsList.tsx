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
}

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

function UnitChip({ unit }: { unit: CompUnit }) {
  return (
    <div
      className={`w-12 h-12 rounded-lg border-2 ${costBorderColor(unit.cost)} overflow-hidden`}
      title={formatUnit(unit.character_id)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={48}
        height={48}
        className="w-12 h-12 object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    </div>
  );
}

function FlexUnitChip({ unit }: { unit: CompUnit }) {
  return (
    <div
      className={`w-12 h-12 rounded-lg border-2 ${costBorderColor(unit.cost)} overflow-hidden`}
      title={formatUnit(unit.character_id)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={48}
        height={48}
        className="w-12 h-12 object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    </div>
  );
}

function CompCard({ comp }: { comp: CompStat }) {
  const [expanded, setExpanded] = useState(false);
  const suggestedFlex = comp.flex_combos[0];
  const winRate = (comp.win_rate ?? 0) * 100;
  const top4Rate = (comp.top4_rate ?? 0) * 100;

  return (
    <div className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden">
      <div
        className="p-4 space-y-3 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-4">
          <div className="w-48 md:w-64 shrink-0 min-h-12">
            {comp.name ? (
              <div className="text-2xl font-bold text-tft-text leading-none truncate">{comp.name}</div>
            ) : null}
            {comp.target_level || comp.core_size || comp.flex_slots || (comp.core_traits && comp.core_traits.length > 0) ? (
              <div className="text-xs text-tft-muted leading-tight mt-1">
                {comp.target_level ? <div>Lv {comp.target_level}</div> : null}
                {comp.core_size || comp.flex_slots ? (
                  <div>
                    Core {comp.core_size ?? comp.core_units.length}
                    {" | "}
                    Flex {comp.flex_slots ?? 0}
                  </div>
                ) : null}
                {comp.core_traits && comp.core_traits.length > 0 ? (
                  <div>
                    Trait core: {formatTrait(comp.core_traits[0].name)} ({comp.core_traits[0].units})
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-start gap-2 flex-wrap">
            {comp.core_units.map((u) => (
              <UnitChip key={u.character_id} unit={u} />
            ))}

            {suggestedFlex ? (
              <div className="flex items-start gap-2 shrink-0">
                <span className="text-tft-muted/60">|</span>
                <div className="flex flex-col items-center">
                  <div className="flex gap-1.5">
                    {suggestedFlex.units.map((u) => (
                      <FlexUnitChip key={`suggest-${u.character_id}`} unit={u} />
                    ))}
                  </div>
                  <div className="text-[9px] uppercase tracking-wide text-tft-muted mt-0.5 flex flex-col items-center leading-none">
                    <span>\/</span>
                    <span className="mt-0.5">Flex</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-end gap-5 shrink-0">
            <div className="text-right leading-none">
              <div className="text-2xl font-bold text-tft-text tabular-nums">{comp.comps}</div>
              <div className="text-[11px] uppercase tracking-wide text-tft-muted mt-1">Frequency</div>
            </div>
            <div className="text-right leading-none">
              <div className="text-xl font-bold text-tft-text tabular-nums">{winRate.toFixed(1)}%</div>
              <div className="text-[11px] uppercase tracking-wide text-tft-muted mt-1">Win Rate</div>
            </div>
            <div className="text-right leading-none">
              <div className="text-xl font-bold text-tft-text tabular-nums">{top4Rate.toFixed(1)}%</div>
              <div className="text-[11px] uppercase tracking-wide text-tft-muted mt-1">Top 4</div>
            </div>
            <div className="text-right leading-none">
              <div className="text-3xl font-extrabold text-tft-gold tabular-nums">{comp.avg_placement.toFixed(2)}</div>
              <div className="text-[11px] uppercase tracking-wide text-tft-muted mt-1">AVP</div>
            </div>
          </div>
          <span className="text-tft-muted text-xs shrink-0">{expanded ? "^" : "v"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-tft-border px-4 py-3 space-y-2">
          {comp.flex_combos.length === 0 ? (
            <p className="text-tft-muted text-sm">No flex triples found for this core.</p>
          ) : (
            comp.flex_combos.map((flex, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 py-1.5 border-b border-tft-border/40 last:border-0"
              >
                <span className="text-tft-muted text-sm w-16 shrink-0">Flex #{idx + 1}</span>
                <div className="flex gap-1.5 shrink-0">
                  {flex.units.map((u) => (
                    <UnitChip key={`${idx}-${u.character_id}`} unit={u} />
                  ))}
                </div>
                <div className="text-xs text-tft-muted ml-auto flex items-end gap-4">
                  <div className="text-right leading-none">
                    <div className="text-base font-semibold text-tft-text tabular-nums">{flex.comps}</div>
                    <div className="text-[10px] uppercase tracking-wide text-tft-muted mt-1">Frequency</div>
                  </div>
                  <div className="text-right leading-none">
                    <div className="text-lg font-bold text-tft-gold tabular-nums">{flex.avg_placement.toFixed(2)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-tft-muted mt-1">AVP</div>
                  </div>
                </div>
              </div>
            ))
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
}: {
  data: CompStat[];
  versions: string[];
  selectedVersion: string;
  basePath?: string;
  showCompMeta?: boolean;
  showHiddenFilters?: boolean;
  selectedCoreSizes?: string;
  selectedMinOccurrences?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");

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
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((comp) => {
      if (comp.name && comp.name.toLowerCase().includes(q)) return true;
      return comp.core_units.some((u) => u.character_id.toLowerCase().includes(q));
    });
  }, [data, search]);

  return (
    <div className="space-y-4">
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

        <span className="text-tft-muted text-sm ml-auto">
          {filtered.length} comps
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No compositions found.
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((comp, i) => (
            <CompCard
              key={`${i}-${comp.core_units.map((u) => u.character_id).join("|")}`}
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
