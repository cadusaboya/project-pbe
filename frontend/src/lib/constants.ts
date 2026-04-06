// Shared constants used across the frontend

/** Default game-version filter applied when no explicit version is in the URL. */
export const DEFAULT_GAME_VERSION = "17 C - 06/04";

export const VALID_SERVERS = ["pbe", "live", "scrims"] as const;
export type ServerSlug = (typeof VALID_SERVERS)[number];

export const VALID_SERVERS_SET = new Set<string>(VALID_SERVERS);

export const STAR_LABELS: Record<number, string> = {
  1: "\u2605",
  2: "\u2605\u2605",
  3: "\u2605\u2605\u2605",
};

export interface TierStyle {
  chip: string;
  num: string;
  iconColor: string;
}

/** Trait tier styles: 0=unique, 1=bronze, 2=silver, 3=gold, 4=chromatic */
export const TRAIT_TIER_STYLES: Record<number, TierStyle> = {
  0: { chip: "bg-red-950/40 border-red-700/60",       num: "text-red-500",    iconColor: "#ef4444" },
  1: { chip: "bg-amber-950/40 border-amber-700/60",   num: "text-amber-600",  iconColor: "#d97706" },
  2: { chip: "bg-slate-800/40 border-slate-400/60",   num: "text-slate-300",  iconColor: "#cbd5e1" },
  3: { chip: "bg-yellow-950/40 border-yellow-600/60", num: "text-yellow-500", iconColor: "#eab308" },
  4: { chip: "bg-violet-950/40 border-violet-500/60", num: "text-violet-400", iconColor: "#a78bfa" },
};

/** Extract server slug from a pathname like "/pbe/comps" -> "pbe" */
export function getServerFromPath(pathname: string): string {
  const first = pathname.split("/")[1]?.toLowerCase();
  return VALID_SERVERS.includes(first as ServerSlug) ? first! : "pbe";
}

export const VALID_TIERS = ["tier1", "tier2", "open"] as const;
export type TierSlug = (typeof VALID_TIERS)[number];
export const VALID_TIERS_SET = new Set<string>(VALID_TIERS);

export const TIER_LABELS: Record<string, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  open: "Open",
};

// Match category / queue constants
export const VALID_QUEUES = ["project_pbe", "pro_random"] as const;
export type QueueSlug = (typeof VALID_QUEUES)[number];

export const QUEUE_LABELS: Record<string, string> = {
  project_pbe: "Project PBE",
  pro_random: "Random Q",
};

/** Default queue for PBE pages */
export const DEFAULT_PBE_QUEUE: QueueSlug = "project_pbe";
/** Default tier for PBE pages (empty = all tiers) */
export const DEFAULT_PBE_TIER = "";
