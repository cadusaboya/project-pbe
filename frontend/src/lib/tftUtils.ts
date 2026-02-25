// Shared TFT utility functions — used by image components and various pages.

export const CDRAGON_BASE = "https://raw.communitydragon.org";

// Cost → Tailwind border-color class (majority pattern across the codebase)
export const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

// Cost → hex colour for fallback backgrounds
export const COST_HEX_COLORS: Record<number, string> = {
  1: "#6b7280",
  2: "#16a34a",
  3: "#3b82f6",
  4: "#a855f7",
  5: "#eab308",
  7: "#eab308",
};

export function costBorderColor(cost: number): string {
  return COST_COLORS[cost] ?? "border-gray-500";
}

export function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

export function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `${CDRAGON_BASE}/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

export function itemImageUrl(itemId: string): string {
  // Set-versioned items: TFT16_Item_WorldRune → .../tft16/tft16_item_worldrune.tft_set16.png
  const setMatch = itemId.match(/^TFT(\d+)_Item_(.+)$/i);
  if (setMatch) {
    const setNum = setMatch[1];
    const lower = itemId.toLowerCase();
    return `${CDRAGON_BASE}/pbe/game/assets/maps/particles/tft/item_icons/tft${setNum}/${lower}.tft_set${setNum}.png`;
  }
  // Standard items: TFT_Item_InfinityEdge → .../standard/infinity_edge.png
  const stdMatch = itemId.match(/^TFT_Item_(.+)$/i);
  if (stdMatch) {
    const name = stdMatch[1]
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase();
    return `${CDRAGON_BASE}/pbe/game/assets/maps/particles/tft/item_icons/standard/${name}.png`;
  }
  return "";
}
