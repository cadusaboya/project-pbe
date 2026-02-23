"use client";

import { useState, useMemo, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Champion {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

interface BoardSlot {
  row: number;
  col: number;
  champion: Champion | null;
}

interface ActiveTrait {
  name: string;
  icon: string;
  currentUnits: number;
  breakpoints: number[];
  activeLevel: number; // index into breakpoints, -1 if below first
}

// ── Constants ────────────────────────────────────────────────────────────────

const ROWS = 4;
const COLS = 7;
const HEX_SIZE = 68;
const ROW_HEIGHT = HEX_SIZE * 0.76;

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

const COST_BG_COLORS: Record<number, string> = {
  1: "bg-gray-500/20",
  2: "bg-green-600/20",
  3: "bg-blue-500/20",
  4: "bg-purple-500/20",
  5: "bg-yellow-400/20",
  7: "bg-yellow-400/20",
};

const COST_TEXT_COLORS: Record<number, string> = {
  1: "text-gray-400",
  2: "text-green-400",
  3: "text-blue-400",
  4: "text-purple-400",
  5: "text-yellow-300",
  7: "text-yellow-300",
};

// ── Unlock data (hardcoded — not available from CDragon) ─────────────────────

const UNLOCK_CONDITIONS: Record<string, string> = {
  // 2-cost
  TFT16_Bard: "Reroll 4 times before Stage 2 Carousel",
  TFT16_Graves: "Field a Twisted Fate with 2 items in combat",
  TFT16_Orianna: "2 items on a Piltover Champion",
  TFT16_Poppy: "Field a Demacian or Yordle with 2 items in combat",
  TFT16_Tryndamere: "Field an Ashe with 1 item in combat",
  TFT16_Yorick: "Field a 2-star Viego with 1 item in combat",
  // 3-cost
  TFT16_Darius: "Have Draven drop 1 gold",
  TFT16_Gwen: "Collect 20 Souls",
  TFT16_Kennen: "7 star levels of Ionia, Yordle, or Defender",
  TFT16_KobukoYuumi: "6 star levels of Bruiser, Yordle, or Invoker + Level 7",
  TFT16_LeBlanc: "Field a Sion with 2 items in combat",
  // 4-cost
  TFT16_Diana: "Field a 2-star Leona with 3 items in combat + Level 6",
  TFT16_Fizz: "Field 5 Yordles or Bilgewater units + Level 7",
  TFT16_KaiSa: "Field a Longshot with 3 items in combat + Level 7",
  TFT16_Kalista: "Collect 75 Souls",
  TFT16_Nasus: "Lost 2/3/5 combats with Azir",
  TFT16_Nidalee: "Field two 2-star Neekos in combat together",
  TFT16_Renekton: "Win 2/3/5 combats with Azir",
  TFT16_RiftHerald: "Have Void active for 8 player combats",
  TFT16_Singed: "Lose 35 Player Health + 4 Zaunites or Juggernauts",
  TFT16_Skarner: "Field a non-Tank with Gargoyle's Stoneplate in combat + Level 7",
  TFT16_Veigar: "Field a unit with 2 Rabadon's Deathcaps in combat",
  TFT16_Warwick: "1 item on Vi AND Jinx + Level 7",
  TFT16_Yone: "3-star Yasuo",
  // 5-cost
  TFT16_Aatrox: "Field a unit with 40% Omnivamp in Combat + Level 8",
  TFT16_Galio: "12 star levels of Demacia",
  TFT16_Mel: "2-star Ambessa with 1 item dies",
  TFT16_Sett: "Level 8 + Field only 1 unit in first 2 rows of combat",
  TFT16_TahmKench: "Spend 450 Silver Serpents",
  TFT16_THex: "9 Piltover star levels",
  TFT16_Thresh: "Collect 150 Souls",
  TFT16_Volibear: "Level 8 + have a unit with 3800 Health",
  TFT16_Xerath: "Alternate winning and losing 3/4/6 times with Azir",
  TFT16_Ziggs: "Field a Yordle or Zaunite with 3 items and Level 9",
  // 7-cost
  TFT16_AurelionSol: "Field Targon 5 in Combat",
  TFT16_BaronNashor: "Level 10 + Void 7",
  TFT16_Brock: "Collect 500 Ixtal Clues total",
  TFT16_Ryze: "Field 4 region traits together in combat + Level 9",
  TFT16_Sylas: "Sell a 2-star Garen/Jarvan IV + reach level 9",
  TFT16_Zaahen: "Get the Xin Zhao Champion Augment + field a 3-star Xin Zhao for 5 rounds",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function isUnlockable(apiName: string): boolean {
  return apiName in UNLOCK_CONDITIONS;
}

function initBoard(): BoardSlot[] {
  const slots: BoardSlot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      slots.push({ row: r, col: c, champion: null });
    }
  }
  return slots;
}

function computeActiveTraits(
  champions: Champion[],
  traitData: TraitData
): ActiveTrait[] {
  const counts: Record<string, number> = {};
  for (const champ of champions) {
    for (const trait of champ.traits) {
      counts[trait] = (counts[trait] || 0) + 1;
    }
  }

  const result: ActiveTrait[] = [];
  for (const [traitName, count] of Object.entries(counts)) {
    const data = traitData[traitName];
    if (!data) continue;

    let activeLevel = -1;
    for (let i = data.breakpoints.length - 1; i >= 0; i--) {
      if (count >= data.breakpoints[i]) {
        activeLevel = i;
        break;
      }
    }

    result.push({
      name: traitName,
      icon: data.icon,
      currentUnits: count,
      breakpoints: data.breakpoints,
      activeLevel,
    });
  }

  result.sort((a, b) => {
    if (a.activeLevel >= 0 && b.activeLevel < 0) return -1;
    if (a.activeLevel < 0 && b.activeLevel >= 0) return 1;
    if (a.activeLevel >= 0 && b.activeLevel >= 0)
      return b.activeLevel - a.activeLevel;
    return b.currentUnits - a.currentUnits;
  });

  return result;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TeamBuilder({
  champions,
  traitData,
}: {
  champions: Champion[];
  traitData: TraitData;
}) {
  const [board, setBoard] = useState<BoardSlot[]>(initBoard);
  const [selectedChampion, setSelectedChampion] = useState<Champion | null>(
    null
  );
  const [searchFilter, setSearchFilter] = useState("");
  const [teamSize, setTeamSize] = useState(9);

  const boardChampions = useMemo(
    () => board.filter((s) => s.champion).map((s) => s.champion!),
    [board]
  );

  const unitCount = boardChampions.length;

  const activeTraits = useMemo(
    () => computeActiveTraits(boardChampions, traitData),
    [boardChampions, traitData]
  );

  const unlockMessages = useMemo(
    () =>
      boardChampions
        .filter((c) => isUnlockable(c.apiName))
        .reduce<{ name: string; apiName: string; condition: string }[]>(
          (acc, c) => {
            if (!acc.some((m) => m.apiName === c.apiName)) {
              acc.push({
                name: c.name,
                apiName: c.apiName,
                condition: UNLOCK_CONDITIONS[c.apiName],
              });
            }
            return acc;
          },
          []
        ),
    [boardChampions]
  );

  // Count how many of each champion are on the board
  const boardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of boardChampions) {
      counts[c.apiName] = (counts[c.apiName] || 0) + 1;
    }
    return counts;
  }, [boardChampions]);

  const costGroups = useMemo(() => {
    const groups: Record<number, Champion[]> = {};
    let filtered = champions;
    if (searchFilter.trim()) {
      const q = searchFilter.trim().toLowerCase();
      filtered = champions.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.apiName.toLowerCase().includes(q) ||
          c.traits.some((t) => formatTrait(t).toLowerCase().includes(q))
      );
    }
    for (const champ of filtered) {
      if (!groups[champ.cost]) groups[champ.cost] = [];
      groups[champ.cost].push(champ);
    }
    return groups;
  }, [champions, searchFilter]);

  const handlePlaceUnit = useCallback(
    (row: number, col: number) => {
      if (!selectedChampion) return;
      if (unitCount >= teamSize) return;

      setBoard((prev) =>
        prev.map((s) =>
          s.row === row && s.col === col && !s.champion
            ? { ...s, champion: selectedChampion }
            : s
        )
      );
    },
    [selectedChampion, unitCount, teamSize]
  );

  const handleRemoveUnit = useCallback((row: number, col: number) => {
    setBoard((prev) =>
      prev.map((s) =>
        s.row === row && s.col === col ? { ...s, champion: null } : s
      )
    );
  }, []);

  const handleHexClick = useCallback(
    (row: number, col: number, hasChampion: boolean) => {
      if (hasChampion) {
        handleRemoveUnit(row, col);
      } else {
        handlePlaceUnit(row, col);
      }
    },
    [handlePlaceUnit, handleRemoveUnit]
  );

  const handleClearBoard = useCallback(() => {
    setBoard(initBoard());
    setSelectedChampion(null);
  }, []);

  const handleSelectChampion = useCallback(
    (champ: Champion) => {
      if (selectedChampion?.apiName === champ.apiName) {
        setSelectedChampion(null);
      } else {
        setSelectedChampion(champ);
      }
    },
    [selectedChampion]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Traits Panel (sidebar on desktop) ─────────────────────────── */}
      <div className="lg:w-56 shrink-0 order-2 lg:order-1">
        <TraitsPanel traits={activeTraits} />
      </div>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 order-1 lg:order-2 space-y-4">
        {/* Controls bar */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-tft-muted">
            Level
            <select
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
              className="bg-tft-surface border border-tft-border rounded px-2 py-1 text-tft-text text-sm"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-tft-muted tabular-nums">
            {unitCount}/{teamSize} units
          </span>
          <button
            onClick={handleClearBoard}
            className="ml-auto px-3 py-1 rounded text-xs font-medium bg-red-900/40 text-red-400 border border-red-800/50 hover:bg-red-900/60 transition-colors"
          >
            Clear Board
          </button>
        </div>

        {/* Hex Grid */}
        <HexGrid
          board={board}
          selectedChampion={selectedChampion}
          onHexClick={handleHexClick}
        />

        {/* Unlock Conditions */}
        {unlockMessages.length > 0 && (
          <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 space-y-1.5">
            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Unlock Requirements
            </div>
            {unlockMessages.map((msg) => (
              <div key={msg.apiName} className="flex items-start gap-2 text-sm">
                <span className="text-tft-text font-medium shrink-0">
                  {msg.name}:
                </span>
                <span className="text-amber-300/80">{msg.condition}</span>
              </div>
            ))}
          </div>
        )}

        {/* Selected champion indicator */}
        {selectedChampion && (
          <div className="flex items-center gap-2 text-sm text-tft-muted">
            <span>Placing:</span>
            <div
              className={`w-8 h-8 rounded border-2 ${costBorderColor(selectedChampion.cost)} overflow-hidden`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={unitImageUrl(selectedChampion.apiName)}
                alt={selectedChampion.name}
                width={32}
                height={32}
                className="w-8 h-8 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    "hidden";
                }}
              />
            </div>
            <span className="text-tft-text font-medium">
              {selectedChampion.name}
            </span>
            <button
              onClick={() => setSelectedChampion(null)}
              className="text-tft-muted hover:text-tft-text text-xs ml-1"
            >
              (cancel)
            </button>
          </div>
        )}

        {/* Champion Pool */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-tft-text">Champions</h2>
            <input
              type="text"
              placeholder="Search by name or trait..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="flex-1 max-w-xs bg-tft-surface border border-tft-border rounded px-3 py-1.5 text-sm text-tft-text placeholder:text-tft-muted/60 focus:outline-none focus:border-tft-accent/50"
            />
          </div>

          {Object.keys(costGroups)
            .map(Number)
            .sort((a, b) => a - b)
            .map((cost) => (
              <div key={cost}>
                <div
                  className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${COST_TEXT_COLORS[cost] ?? "text-gray-400"}`}
                >
                  {cost}-Cost
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {costGroups[cost].map((champ) => {
                    const isSelected =
                      selectedChampion?.apiName === champ.apiName;
                    const onBoard = boardCounts[champ.apiName] || 0;
                    const unlockable = isUnlockable(champ.apiName);

                    return (
                      <button
                        key={champ.apiName}
                        onClick={() => handleSelectChampion(champ)}
                        title={`${champ.name}${unlockable ? " (Unlockable)" : ""}\n${champ.traits.map(formatTrait).join(", ")}`}
                        className={`relative w-11 h-11 rounded-lg border-2 overflow-hidden shrink-0 transition-all ${costBorderColor(champ.cost)} ${
                          isSelected
                            ? "ring-2 ring-tft-gold ring-offset-1 ring-offset-tft-bg scale-110"
                            : "hover:brightness-125"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={unitImageUrl(champ.apiName)}
                          alt={champ.name}
                          width={44}
                          height={44}
                          className="w-11 h-11 object-cover"
                          onError={(e) => {
                            (
                              e.currentTarget as HTMLImageElement
                            ).style.visibility = "hidden";
                          }}
                        />
                        {/* Lock icon for unlockable */}
                        {unlockable && (
                          <div className="absolute top-0 right-0 bg-amber-900/80 rounded-bl p-0.5">
                            <svg
                              width="8"
                              height="8"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="text-amber-400"
                            >
                              <rect
                                x="3"
                                y="11"
                                width="18"
                                height="11"
                                rx="2"
                                ry="2"
                              />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          </div>
                        )}
                        {/* Count badge */}
                        {onBoard > 0 && (
                          <div className="absolute bottom-0 left-0 bg-tft-gold text-tft-bg text-[9px] font-bold rounded-tr px-1 leading-tight">
                            {onBoard}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── HexGrid Sub-component ────────────────────────────────────────────────────

function HexGrid({
  board,
  selectedChampion,
  onHexClick,
}: {
  board: BoardSlot[];
  selectedChampion: Champion | null;
  onHexClick: (row: number, col: number, hasChampion: boolean) => void;
}) {
  const gridWidth = COLS * HEX_SIZE + HEX_SIZE / 2 + 4;
  const gridHeight = ROWS * ROW_HEIGHT + HEX_SIZE * 0.24 + 4;

  return (
    <div className="flex justify-center">
      <div
        className="relative"
        style={{ width: gridWidth, height: gridHeight }}
      >
        {board.map((slot) => {
          const x =
            slot.col * HEX_SIZE + (slot.row % 2 === 1 ? HEX_SIZE / 2 : 0);
          const y = slot.row * ROW_HEIGHT;
          const hasChamp = !!slot.champion;

          return (
            <div
              key={`${slot.row}-${slot.col}`}
              className="absolute"
              style={{ left: x, top: y, width: HEX_SIZE, height: HEX_SIZE }}
            >
              <button
                onClick={() => onHexClick(slot.row, slot.col, hasChamp)}
                className={`w-full h-full flex items-center justify-center transition-all ${
                  hasChamp
                    ? "hover:brightness-75"
                    : selectedChampion
                      ? "hover:brightness-150 cursor-pointer"
                      : "cursor-default"
                }`}
                style={{
                  clipPath:
                    "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                }}
              >
                <div
                  className={`w-full h-full flex items-center justify-center ${
                    hasChamp
                      ? `${COST_BG_COLORS[slot.champion!.cost] ?? "bg-gray-500/20"} border-2 ${costBorderColor(slot.champion!.cost)}`
                      : "bg-tft-surface/50 border border-tft-border/60"
                  }`}
                  style={{
                    clipPath:
                      "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                  }}
                >
                  {hasChamp ? (
                    <div className="relative w-10 h-10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={unitImageUrl(slot.champion!.apiName)}
                        alt={slot.champion!.name}
                        width={40}
                        height={40}
                        className="w-10 h-10 object-cover rounded"
                        onError={(e) => {
                          (
                            e.currentTarget as HTMLImageElement
                          ).style.visibility = "hidden";
                        }}
                      />
                    </div>
                  ) : (
                    <span className="text-tft-border text-lg">+</span>
                  )}
                </div>
              </button>
              {/* Champion name label */}
              {hasChamp && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-tft-text font-medium whitespace-nowrap bg-tft-bg/80 px-1 rounded">
                  {formatUnit(slot.champion!.apiName)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TraitsPanel Sub-component ────────────────────────────────────────────────

function TraitsPanel({ traits }: { traits: ActiveTrait[] }) {
  if (traits.length === 0) {
    return (
      <div className="rounded-lg border border-tft-border bg-tft-surface/40 p-3">
        <h2 className="text-sm font-semibold text-tft-text mb-2">
          Active Traits
        </h2>
        <p className="text-xs text-tft-muted">
          Add champions to the board to see active traits.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-tft-border bg-tft-surface/40 p-3 space-y-1.5">
      <h2 className="text-sm font-semibold text-tft-text mb-2">
        Active Traits
      </h2>
      {traits.map((trait) => {
        const isActive = trait.activeLevel >= 0;
        const nextBp =
          trait.activeLevel < trait.breakpoints.length - 1
            ? trait.breakpoints[trait.activeLevel + 1]
            : null;
        const currentBp = isActive
          ? trait.breakpoints[trait.activeLevel]
          : null;

        return (
          <div
            key={trait.name}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
              isActive
                ? "bg-tft-gold/10 border border-tft-gold/25"
                : "bg-tft-surface/60 border border-tft-border/40"
            }`}
          >
            {/* Trait icon */}
            {trait.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={trait.icon}
                alt={formatTrait(trait.name)}
                width={18}
                height={18}
                className={`w-[18px] h-[18px] ${isActive ? "" : "opacity-50 grayscale"}`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    "hidden";
                }}
              />
            ) : (
              <div className="w-[18px] h-[18px] rounded bg-tft-border" />
            )}

            {/* Trait name + count */}
            <div className="flex-1 min-w-0">
              <span
                className={`font-medium ${isActive ? "text-tft-gold" : "text-tft-muted"}`}
              >
                {formatTrait(trait.name)}
              </span>
            </div>

            {/* Breakpoint progress */}
            <div className="flex items-center gap-1 shrink-0">
              <span
                className={`font-bold tabular-nums ${isActive ? "text-tft-gold" : "text-tft-muted"}`}
              >
                {trait.currentUnits}
              </span>
              <span className="text-tft-muted">/</span>
              <span className="text-tft-muted tabular-nums">
                {nextBp ?? currentBp ?? trait.breakpoints[0]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
