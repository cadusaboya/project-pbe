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

// ---------------------------------------------------------------------------
// Team Planner code generation
// Format: "02" + 10 champion slots (3-digit hex each, 000=empty) + "TFTSet{N}"
// Champion hex = team_planner_code from CDragon tftchampions-teamplanner.json
// ---------------------------------------------------------------------------

export type TeamPlannerMap = Record<string, string>; // character_id → 3-digit hex

const TEAM_PLANNER_URL = `${CDRAGON_BASE}/pbe/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json`;

let _plannerMapCache: { map: TeamPlannerMap; setKey: string } | null = null;

export async function fetchTeamPlannerMap(): Promise<{ map: TeamPlannerMap; setKey: string }> {
  if (_plannerMapCache) return _plannerMapCache;
  const resp = await fetch(TEAM_PLANNER_URL);
  const data: Record<string, { character_id: string; team_planner_code: number }[]> = await resp.json();
  // Pick the set with the highest numeric ID (e.g. TFTSet16 > TFTSet4_Act2)
  const setKeys = Object.keys(data).filter((k) => k.startsWith("TFTSet"));
  const setKey = setKeys.sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return na - nb;
  }).pop() ?? "TFTSet16";
  const champions = data[setKey] ?? [];
  const map: TeamPlannerMap = {};
  for (const c of champions) {
    map[c.character_id] = c.team_planner_code.toString(16).toLowerCase().padStart(3, "0");
  }
  _plannerMapCache = { map, setKey };
  return _plannerMapCache;
}

export function generateTeamPlannerCode(
  characterIds: string[],
  plannerMap: TeamPlannerMap,
  setKey = "TFTSet16",
): string {
  const slots: string[] = [];
  for (const id of characterIds) {
    const hex = plannerMap[id];
    if (hex) slots.push(hex);
  }
  while (slots.length < 10) slots.push("000");
  return "02" + slots.join("") + setKey;
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
