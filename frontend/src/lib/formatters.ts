// Shared formatting and color utility functions

/** Comp tier based on average placement */
export function compTier(avp: number): { label: string; color: string; bg: string } {
  if (avp < 3.7) return { label: "S", color: "text-red-400", bg: "bg-red-500/20 border border-red-500/40" };
  if (avp < 4.0) return { label: "A", color: "text-orange-400", bg: "bg-orange-500/20 border border-orange-500/40" };
  if (avp < 4.4) return { label: "B", color: "text-yellow-400", bg: "bg-yellow-500/20 border border-yellow-500/40" };
  if (avp < 4.8) return { label: "C", color: "text-lime-400", bg: "bg-lime-500/20 border border-lime-500/40" };
  return { label: "D", color: "text-slate-400", bg: "bg-slate-500/15 border border-slate-500/30" };
}

/** Color for average placement text */
export function avpColor(avp: number): string {
  if (avp <= 3.5) return "text-emerald-400";
  if (avp <= 4.0) return "text-teal-400";
  if (avp <= 4.5) return "text-amber-300";
  return "text-rose-400";
}

/** More granular AVP text color for stat displays */
export function avpTextColor(avp: number): string {
  if (avp <= 3.2) return "text-emerald-400";
  if (avp <= 3.7) return "text-teal-400";
  if (avp <= 4.0) return "text-green-300";
  if (avp <= 4.4) return "text-amber-300/90";
  if (avp <= 4.8) return "text-orange-400/80";
  return "text-rose-400/80";
}

/** Relative time formatting: "Just now", "5 minutes ago", etc. */
export function formatDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

/** Compact relative time: "5m ago", "3h ago" */
export function formatDateCompact(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Extract display name from "Player#Tag" */
export function displayPlayerName(name: string): string {
  return name.split("#")[0].trim();
}

/** Format raw item ID to human-readable name */
export function formatItemName(itemName: string, itemNames?: Record<string, string>): string {
  if (itemNames?.[itemName]) return itemNames[itemName];
  return itemName.replace(/^TFT\d*_Item_/, "").replace(/([A-Z])/g, " $1").trim();
}

/** Format trait API name to display name */
export function formatTrait(name: string): string {
  return name.replace(/^TFT\d+_/, "").replace(/^Set\d+_/, "");
}

// ── Placement colors ──────────────────────────────────────────────────────────

/** Color class for placement value in stat tables */
export function placementColor(placement: number): string {
  if (placement <= 2) return "text-yellow-400 font-semibold";
  if (placement <= 4) return "text-green-400";
  if (placement <= 6) return "text-tft-text";
  return "text-red-400";
}

/** Badge background+text for placement chips */
export function placementBadge(p: number): string {
  if (p === 1) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  if (p <= 4) return "bg-green-500/20 text-green-400 border-green-500/40";
  return "bg-tft-surface text-tft-muted border-tft-border";
}

/** Text style for placement in match results */
export function placementStyle(p: number): string {
  if (p === 1) return "text-yellow-400 font-bold";
  if (p <= 4) return "text-green-400 font-semibold";
  return "text-tft-muted";
}

// ── Stat colors ─────────────────────────────────────────────────────────────

export function winRateColor(rate: number): string {
  if (rate > 0.2) return "text-green-400 font-semibold";
  if (rate >= 0.15) return "text-yellow-400 font-semibold";
  if (rate <= 0.05) return "text-tft-muted";
  return "text-red-400";
}

export function top4RateColor(rate: number): string {
  if (rate > 0.5) return "text-green-400 font-semibold";
  if (rate < 0.3) return "text-tft-muted";
  return "text-red-400";
}

export function deltaColor(delta: number): string {
  if (delta < -0.5) return "text-green-400 font-bold";
  if (delta < 0) return "text-green-400";
  if (delta === 0) return "text-tft-muted";
  if (delta <= 0.5) return "text-red-400";
  return "text-red-400 font-bold";
}
