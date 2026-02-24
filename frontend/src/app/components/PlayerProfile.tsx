"use client";

import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerInfo {
  game_name: string;
  tag_line: string;
}

interface Last20Entry {
  match_id: string;
  game_datetime: string;
  placement: number;
}

interface TopUnit {
  character_id: string;
  cost: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
}

interface MatchUnit {
  character_id: string;
  star_level: number;
  cost: number;
  traits: string[];
  items: string[];
}

interface MatchEntry {
  match_id: string;
  game_datetime: string;
  game_version: string;
  placement: number;
  level: number;
  units: MatchUnit[];
}

interface LobbyParticipant {
  name: string;
  placement: number;
  level: number;
  gold_left: number;
  units: MatchUnit[];
  augments: string[];
}

export interface TraitInfo {
  breakpoints: number[];
  icon: string;
}

export interface PlayerProfileData {
  player: PlayerInfo;
  total_games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  last_20: Last20Entry[];
  top_units: TopUnit[];
  match_history: MatchEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function displayPlayerName(name: string): string {
  return name.split("#")[0].trim();
}

// ── Cost colors ──────────────────────────────────────────────────────────────

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

const COST_BG: Record<number, string> = {
  1: "bg-gray-500/10 border-gray-500/40 text-gray-400",
  2: "bg-green-600/10 border-green-600/40 text-green-400",
  3: "bg-blue-500/10 border-blue-500/40 text-blue-400",
  4: "bg-purple-500/10 border-purple-500/40 text-purple-400",
  5: "bg-yellow-400/10 border-yellow-400/40 text-yellow-300",
  7: "bg-yellow-400/10 border-yellow-400/40 text-yellow-300",
};

function placementStyle(p: number): string {
  if (p === 1) return "text-yellow-400 font-bold";
  if (p <= 4) return "text-green-400 font-semibold";
  return "text-tft-muted";
}

function placementBg(p: number): string {
  if (p === 1) return "bg-yellow-400/20 border-yellow-400/50";
  if (p <= 4) return "bg-green-500/15 border-green-500/40";
  if (p <= 6) return "bg-tft-surface border-tft-border";
  return "bg-red-500/10 border-red-500/30";
}

// ── Trait helpers ─────────────────────────────────────────────────────────────

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

const TRAIT_TIER_STYLES: Record<number, TierStyle> = {
  0: { chip: "bg-red-950/40 border-red-700/60", num: "text-red-500", iconColor: "#ef4444" },
  1: { chip: "bg-amber-950/40 border-amber-700/60", num: "text-amber-600", iconColor: "#d97706" },
  2: { chip: "bg-slate-800/40 border-slate-400/60", num: "text-slate-300", iconColor: "#cbd5e1" },
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" },
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" },
};

function computeTraits(
  units: MatchUnit[],
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

function TraitChips({
  units,
  traitData,
}: {
  units: MatchUnit[];
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
            className={`inline-flex items-center gap-0.5 pl-0.5 pr-1.5 h-5 rounded border text-[10px] font-bold ${style.chip}`}
            title={`${t.name} ${suffix} — breakpoints ${t.breakpoints.join("/")}`}
          >
            {t.icon && (
              <span
                className="w-3.5 h-3.5 shrink-0 inline-block"
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

// ── Star level ───────────────────────────────────────────────────────────────

function StarLevel({ level }: { level: number }) {
  const stars = "★".repeat(level);
  const colors = ["", "text-amber-700", "text-slate-300", "text-yellow-400"];
  return (
    <span className={`text-[9px] font-bold leading-none ${colors[level] ?? "text-gray-400"}`}>
      {stars}
    </span>
  );
}

// ── Unit chip (compact for profile) ──────────────────────────────────────────

function UnitChip({
  unit,
  itemAssets,
  itemNames,
  size = "normal",
}: {
  unit: MatchUnit;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  size?: "normal" | "small";
}) {
  const border = costColor(unit.cost);
  const dim = size === "small" ? "w-9 h-9" : "w-11 h-11";
  const itemDim = size === "small" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <div className={`relative border-2 rounded-md ${border}`} title={formatUnit(unit.character_id)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        className={`${dim} block rounded object-cover`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="absolute -top-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-2 left-0 right-0 flex justify-center z-10 pointer-events-none">
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
                className={`${itemDim} rounded object-cover`}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Last 20 chart ────────────────────────────────────────────────────────────

function Last20Chart({ games }: { games: Last20Entry[] }) {
  if (games.length === 0) return null;

  // Reverse so oldest is on the left, newest on the right
  const chronological = [...games].reverse();

  const placementColors = (p: number) => {
    if (p === 1) return "bg-yellow-600/80 border-yellow-700 text-white";
    if (p <= 4) return "bg-teal-700/80 border-teal-800 text-white";
    if (p <= 6) return "bg-slate-700/80 border-slate-800 text-white/80";
    return "bg-rose-800/80 border-rose-900 text-white/80";
  };

  // Split into rows of 10
  const rows: Last20Entry[][] = [];
  for (let i = 0; i < chronological.length; i += 10) {
    rows.push(chronological.slice(i, i + 10));
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, ri) => (
        <div key={ri} className="flex flex-wrap gap-1">
          {row.map((g, i) => (
            <div
              key={i}
              className={`w-7 h-7 rounded border flex items-center justify-center text-xs font-bold ${placementColors(g.placement)}`}
              title={`#${g.placement} — ${formatDate(g.game_datetime)}`}
            >
              {g.placement}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Match row ────────────────────────────────────────────────────────────────

function MatchRow({
  match,
  itemAssets,
  itemNames,
  traitData,
}: {
  match: MatchEntry;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  traitData: Record<string, TraitInfo>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoading(true);
      try {
        const res = await fetch(`/api/match/${match.match_id}/lobby`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLobby(await res.json());
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    setExpanded((e) => !e);
  }

  const accentColor =
    match.placement === 1
      ? "bg-yellow-400"
      : match.placement <= 4
      ? "bg-green-500"
      : match.placement <= 6
      ? "bg-tft-muted"
      : "bg-red-500";

  return (
    <div className="border border-tft-border rounded-lg overflow-hidden bg-tft-surface/60 flex">
      {/* Left accent stripe */}
      <div className={`w-1 shrink-0 ${accentColor}`} />

      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2.5 cursor-pointer select-none hover:bg-tft-hover transition-colors"
          onClick={handleToggle}
        >
          {/* Placement number */}
          <span className={`text-xl font-bold w-6 shrink-0 ${placementStyle(match.placement)}`}>
            {match.placement}
          </span>

          {/* Center: traits + units */}
          <div className="flex flex-col gap-2.5 flex-1 min-w-0">
            <TraitChips units={match.units} traitData={traitData} />
            <div className="flex flex-wrap gap-1">
              {match.units
                .slice()
                .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                .map((unit, i) => (
                  <UnitChip key={i} unit={unit} itemAssets={itemAssets} itemNames={itemNames} size="small" />
                ))}
            </div>
          </div>

          {/* Right meta */}
          <div className="flex flex-col items-end shrink-0 gap-0.5">
            <span className="text-tft-muted text-xs">{formatDate(match.game_datetime)}</span>
            <span className="text-tft-muted text-[10px]">Lv{match.level}</span>
          </div>

          <span className="text-tft-muted text-xs shrink-0">
            {expanded ? "▲" : "▼"}
          </span>
        </div>

        {/* Expanded lobby */}
        {expanded && (
          <div className="border-t border-tft-border/40 px-2 sm:px-3 py-2 space-y-1 bg-tft-bg/40">
            {loading && (
              <p className="text-tft-muted text-sm text-center py-3">Loading lobby...</p>
            )}
            {lobby &&
              lobby.map((participant, i) => (
                <div
                  key={i}
                  className={`py-1.5 ${i < lobby.length - 1 ? "border-b border-tft-border/30" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-5 text-sm text-right shrink-0 ${placementStyle(participant.placement)}`}
                    >
                      #{participant.placement}
                    </span>
                    <a
                      href={`/player/${encodeURIComponent(participant.name.split("#")[0])}`}
                      className="text-tft-text text-sm w-24 sm:w-36 truncate shrink-0 hover:text-tft-gold transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {displayPlayerName(participant.name)}
                    </a>
                    <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                      <TraitChips units={participant.units} traitData={traitData} />
                      <div className="flex flex-wrap gap-1">
                        {participant.units
                          .slice()
                          .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                          .map((unit, j) => (
                            <UnitChip key={j} unit={unit} itemAssets={itemAssets} size="small" />
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PlayerProfile({
  data,
  itemAssets,
  itemNames,
  traitData,
}: {
  data: PlayerProfileData;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  traitData: Record<string, TraitInfo>;
}) {
  const { player, total_games, avg_placement, top4_rate, win_rate, last_20, top_units, match_history } = data;
  const [visibleMatches, setVisibleMatches] = useState(20);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="border border-tft-border rounded-xl bg-tft-surface/60 p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 sm:gap-6">
          {/* Player name + tag */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-tft-text truncate">
              {player.game_name}
              <span className="text-tft-muted text-base sm:text-lg font-normal ml-1">#{player.tag_line}</span>
            </h1>
            <p className="text-tft-muted text-sm mt-1">{total_games} games tracked</p>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="AVP"
              value={avg_placement.toFixed(2)}
              color={avg_placement <= 3.5 ? "text-teal-400" : avg_placement <= 4 ? "text-cyan-400" : avg_placement <= 4.5 ? "text-slate-300" : "text-rose-400/70"}
              accent={avg_placement <= 3.5 ? "bg-teal-400" : avg_placement <= 4 ? "bg-cyan-400" : avg_placement <= 4.5 ? "bg-slate-400" : "bg-rose-400"}
            />
            <StatCard
              label="Win Rate"
              value={`${(win_rate * 100).toFixed(1)}%`}
              color={win_rate >= 0.15 ? "text-teal-400" : win_rate >= 0.10 ? "text-cyan-400" : "text-tft-muted"}
              accent={win_rate >= 0.15 ? "bg-teal-400" : win_rate >= 0.10 ? "bg-cyan-400" : "bg-tft-muted"}
            />
            <StatCard
              label="Top 4"
              value={`${(top4_rate * 100).toFixed(1)}%`}
              color={top4_rate >= 0.5 ? "text-teal-400" : top4_rate >= 0.4 ? "text-cyan-400" : "text-tft-muted"}
              accent={top4_rate >= 0.5 ? "bg-teal-400" : top4_rate >= 0.4 ? "bg-cyan-400" : "bg-tft-muted"}
            />
            <StatCard
              label="Games"
              value={total_games.toString()}
              color="text-tft-text"
              accent="bg-tft-gold"
            />
          </div>
        </div>
      </div>

      {/* ── Sidebar + Match History ── */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left sidebar: Last 20 + Most Played stacked */}
        <div className="w-full lg:w-[350px] shrink-0 space-y-4">
          {last_20.length > 0 && (
            <div className="border border-tft-border rounded-xl bg-tft-surface/60 p-4">
              <h2 className="text-sm font-semibold text-tft-text mb-2">Last {last_20.length} Games</h2>
              <Last20Chart games={last_20} />
            </div>
          )}

          {top_units.length > 0 && (
            <div className="border border-tft-border rounded-xl bg-tft-surface/60 p-4">
              <div className="flex items-center mb-2 px-2 gap-2">
                <h2 className="text-sm font-semibold text-tft-text flex-1 min-w-0">Most Played</h2>
                <span className="text-[10px] text-tft-muted font-medium uppercase tracking-wide w-10 text-right shrink-0">AVP</span>
                <span className="text-[10px] text-tft-muted font-medium uppercase tracking-wide w-16 text-right shrink-0">Top4%</span>
              </div>
              <div className="space-y-1">
                {top_units.slice(0, 8).map((unit) => (
                  <TopUnitRow key={unit.character_id} unit={unit} totalGames={total_games} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Match history */}
        {match_history.length > 0 && (
          <div className="flex-1 min-w-0 border border-tft-border rounded-xl bg-tft-surface/60 p-3 sm:p-5">
            <h2 className="text-base sm:text-lg font-semibold text-tft-text mb-3">Match History</h2>
            <div className="space-y-2">
              {match_history.slice(0, visibleMatches).map((match) => (
                <MatchRow
                  key={match.match_id}
                  match={match}
                  itemAssets={itemAssets}
                  itemNames={itemNames}
                  traitData={traitData}
                />
              ))}
            </div>
            {visibleMatches < match_history.length && (
              <button
                onClick={() => setVisibleMatches((v) => v + 20)}
                className="mt-3 w-full py-2 rounded-lg border border-tft-border bg-tft-surface hover:bg-tft-hover text-sm text-tft-muted hover:text-tft-text transition-colors"
              >
                Load more ({match_history.length - visibleMatches} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: string;
  color: string;
  accent: string;
}) {
  return (
    <div className="bg-tft-bg/60 border border-tft-border rounded-lg overflow-hidden text-center">
      <div className={`h-0.5 ${accent}`} />
      <div className="px-3 sm:px-4 py-2.5 sm:py-3">
        <p className="text-tft-muted text-[10px] sm:text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function TopUnitRow({ unit, totalGames }: { unit: TopUnit; totalGames: number }) {
  const playRate = (unit.games / totalGames) * 100;
  const avpCol = unit.avg_placement <= 3.5 ? "text-teal-400" : unit.avg_placement <= 4 ? "text-cyan-400" : unit.avg_placement <= 4.5 ? "text-slate-300" : "text-rose-400/70";

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={unitImageUrl(unit.character_id)}
        alt={formatUnit(unit.character_id)}
        className={`w-8 h-8 rounded border-2 ${costColor(unit.cost)} object-cover shrink-0`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
      />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-tft-text truncate block">{formatUnit(unit.character_id)}</span>
        <span className="text-[10px] text-tft-muted">{unit.games} games · {playRate.toFixed(0)}%</span>
      </div>
      <span className={`text-xs font-semibold tabular-nums shrink-0 w-10 text-right ${avpCol}`}>
        {unit.avg_placement.toFixed(2)}
      </span>
      <span className="text-[10px] text-tft-muted tabular-nums shrink-0 w-16 text-right">
        {(unit.top4_rate * 100).toFixed(0)}%
      </span>
    </div>
  );
}
