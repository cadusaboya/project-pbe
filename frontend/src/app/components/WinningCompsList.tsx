"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

function formatUnit(id: string): string {
  return id.replace(/^TFT\d+_/, "");
}

function formatItem(id: string, itemNames?: Record<string, string>): string {
  if (itemNames?.[id]) return itemNames[id];
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
  chip: string;       // chip background + border (Tailwind)
  num: string;        // number text color (Tailwind)
  iconColor: string;  // exact hex — same hue as border/num, used as icon mask color
}

// tier 0=unique, 1=bronze, 2=silver, 3=gold, 4=chromatic
// iconColor hex values match the Tailwind num/border colors exactly
const TRAIT_TIER_STYLES: Record<number, TierStyle> = {
  0: { chip: "bg-red-950/40 border-red-700/60",       num: "text-red-500",    iconColor: "#ef4444" }, // unique
  1: { chip: "bg-amber-950/40 border-amber-700/60",   num: "text-amber-600",  iconColor: "#d97706" }, // bronze
  2: { chip: "bg-slate-800/40 border-slate-400/60",   num: "text-slate-300",  iconColor: "#cbd5e1" }, // silver
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" }, // gold
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" }, // chromatic
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
      // Traits with only one breakpoint at 1 are "unique" — style separately
      const isUnique = breakpoints.length === 1 && breakpoints[0] === 1;
      result.push({ name, count, tier: isUnique ? 0 : tier, breakpoints, icon, isUnique });
    }
  }
  // Sort: higher tier first, then count; unique (tier=0) go last
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

// cost 1=gray, 2=green, 3=blue, 4=purple, 5/7=gold
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

function placementStyle(p: number): string {
  if (p === 1) return "text-yellow-400 font-bold";
  if (p <= 4) return "text-green-400 font-semibold";
  return "text-tft-muted";
}

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
  itemNames,
}: {
  unit: WinningUnit;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
}) {
  const border = costColor(unit.cost);
  const traitTitle = unit.traits.length
    ? `${formatUnit(unit.character_id)} — ${unit.traits.join(", ")}`
    : formatUnit(unit.character_id);

  return (
    <div
      className={`relative border-2 rounded-lg ${border}`}
      title={traitTitle}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        width={48}
        height={48}
        className="w-12 h-12 block rounded object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      {/* Stars overlapping top of image */}
      <div className="absolute -top-3 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {/* Items overlapping bottom of image */}
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
                alt={formatItem(item, itemNames)}
                title={formatItem(item, itemNames)}
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

function CompCard({
  comp,
  itemAssets,
  itemNames,
  traitData,
}: {
  comp: WinningComp;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  traitData: Record<string, TraitInfo>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoading(true);
      setLobbyError(null);
      try {
        const res = await fetch(`/api/match/${comp.match_id}/lobby`);
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
      {/* Header — click to expand */}
      <div
        className="p-4 space-y-3 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <a
              href={`/player/${encodeURIComponent(comp.winner.split("#")[0])}`}
              onClick={(e) => e.stopPropagation()}
              className="text-tft-gold font-semibold hover:underline"
            >
              #1 {displayPlayerName(comp.winner)}
            </a>
            <div className="text-tft-muted text-xs mt-0.5 flex flex-wrap items-center gap-1.5">
              {formatDate(comp.game_datetime)}
              {comp.game_version && (
                <span className="px-1.5 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted">
                  {comp.game_version}
                </span>
              )}
              <TraitChips units={comp.units} traitData={traitData} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/player/${encodeURIComponent(comp.winner.split("#")[0])}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs px-2 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted hover:text-tft-text hover:border-tft-accent transition-colors"
              title="View player stats"
            >
              Player Stats
            </a>
            <span className="text-tft-muted text-xs">
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {comp.units
            .slice()
            .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
            .map((unit, i) => (
              <UnitChip key={i} unit={unit} itemAssets={itemAssets} itemNames={itemNames} />
            ))}
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
            lobby.filter((p) => p.placement !== 1).map((participant, i, arr) => (
              <div
                key={i}
                className={`py-1.5 ${
                  i < arr.length - 1 ? "border-b border-tft-border/40" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-5 text-sm text-right shrink-0 ${placementStyle(participant.placement)}`}
                  >
                    #{participant.placement}
                  </span>
                  <a
                    href={`/player/${encodeURIComponent(participant.name.split("#")[0])}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-tft-text text-sm w-40 truncate shrink-0 hover:text-tft-gold transition-colors"
                  >
                    {displayPlayerName(participant.name)}
                  </a>
                  <div className="flex flex-col gap-1.5">
                    <TraitChips units={participant.units} traitData={traitData} />
                    <div className="flex flex-wrap gap-1">
                      {participant.units
                        .slice()
                        .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                        .map((unit, j) => (
                          <UnitChip
                            key={j}
                            unit={unit}
                            itemAssets={itemAssets}
                            itemNames={itemNames}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function WinningCompsList({
  data,
  itemAssets,
  itemNames,
  versions,
  selectedVersion,
  traitData,
}: {
  data: WinningComp[];
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  versions: string[];
  selectedVersion: string;
  traitData: Record<string, TraitInfo>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");

  function handleVersionChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) {
      params.set("game_version", v);
    } else {
      params.delete("game_version");
    }
    router.push(`/last-games?${params.toString()}`);
  }

  const filtered = useMemo<WinningComp[]>(() => {
    let rows = data;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        displayPlayerName(r.winner).toLowerCase().includes(q)
      );
    }

    if (unitFilter.trim()) {
      const q = unitFilter.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.units.some((u) => u.character_id.toLowerCase().includes(q))
      );
    }

    return rows;
  }, [data, search, unitFilter]);

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
          placeholder="Search by winning player..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-48"
        />
        <input
          type="text"
          placeholder="Filter by winning units..."
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="bg-tft-surface border border-tft-border text-tft-text placeholder-tft-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:border-tft-accent w-48"
        />
        <span className="text-tft-muted text-sm ml-auto">
          {filtered.length} comps
        </span>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No comps found.
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((comp) => (
            <CompCard key={comp.match_id} comp={comp} itemAssets={itemAssets} itemNames={itemNames} traitData={traitData} />
          ))}
        </div>
      )}
    </div>
  );
}

