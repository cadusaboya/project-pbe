// Centralized type definitions for API responses and shared data structures

/** A unit on a board (used in match results, search results, explore results) */
export interface BoardUnit {
  character_id: string;
  star_level: number;
  cost: number;
  traits: string[];
  items: string[];
}

/** Participant in a match lobby expansion */
export interface LobbyParticipant {
  name: string;
  placement: number;
  level: number;
  gold_left: number;
  units: BoardUnit[];
  augments: string[];
}

/** Trait breakpoint + icon info from /api/traits/ */
export interface TraitInfo {
  breakpoints: number[];
  icon: string;
}

/** Computed trait state for display */
export interface TraitState {
  name: string;
  count: number;
  /** 0=unique, 1=bronze, 2=silver, 3=gold, 4=chromatic */
  tier: number;
  breakpoints: number[];
  icon: string;
  isUnique: boolean;
}

/** Unit stat from /api/unit-stats/ */
export interface UnitStat {
  unit_name: string;
  cost: number;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
}

/** Lobby player (minimal placement info) */
export interface LobbyPlayer {
  name: string;
  placement: number;
}

/** Player identity info */
export interface PlayerInfo {
  game_name: string;
  tag_line: string;
  region?: string;
}

/** Compute active traits from a unit list and trait data */
export function computeTraits(
  units: { traits: string[] }[],
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
