"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface TopUnit {
  character_id: string;
  cost: number;
  games: number;
}

export interface PlayerStat {
  game_name: string;
  tag_line: string;
  games: number;
  avg_placement: number;
  top4_rate: number;
  win_rate: number;
  top_units: TopUnit[];
}

const COST_COLORS: Record<number, string> = {
  1: "border-gray-400",
  2: "border-green-400",
  3: "border-blue-400",
  4: "border-purple-400",
  5: "border-yellow-400",
};

function costBorderColor(cost: number): string {
  return COST_COLORS[cost] ?? "border-gray-500";
}

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
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

type SortKey = "games" | "avg_placement" | "win_rate" | "top4_rate";

export default function PlayerStatsList({ data }: { data: PlayerStat[] }) {
  const [sort, setSort] = useState<SortKey>("avg_placement");
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");
  const [minGames, setMinGames] = useState(0);
  const router = useRouter();

  function handleSort(key: SortKey) {
    if (sort === key) {
      setSortAsc((v) => !v);
    } else {
      setSort(key);
      setSortAsc(key === "avg_placement");
    }
  }

  const rows = useMemo(() => {
    let filtered = data;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((p) => p.game_name.toLowerCase().includes(q));
    }
    if (minGames > 0) {
      filtered = filtered.filter((p) => p.games >= minGames);
    }
    return [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      return sortAsc ? av - bv : bv - av;
    });
  }, [data, sort, sortAsc, search, minGames]);

  const columns: { key: SortKey | null; label: string; align: string }[] = [
    { key: null, label: "#", align: "text-left" },
    { key: null, label: "Player", align: "text-left" },
    { key: "games", label: "Games", align: "text-center" },
    { key: "avg_placement", label: "AVP", align: "text-center" },
    { key: "win_rate", label: "Win%", align: "text-center" },
    { key: "top4_rate", label: "Top 4%", align: "text-center" },
    { key: null, label: "Most Common Units", align: "text-left" },
  ];

  function sortArrow(key: SortKey | null): string {
    if (!key || sort !== key) return "";
    return sortAsc ? " ↑" : " ↓";
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search player..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-md text-sm bg-tft-surface border border-tft-border text-tft-text placeholder:text-tft-muted focus:outline-none focus:border-tft-accent flex-1 min-w-[120px] max-w-[220px]"
        />
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-tft-muted">Min games:</label>
          <input
            type="number"
            min={0}
            value={minGames || ""}
            onChange={(e) => setMinGames(parseInt(e.target.value) || 0)}
            placeholder="0"
            className="px-2 py-1.5 rounded-md text-sm bg-tft-surface border border-tft-border text-tft-text placeholder:text-tft-muted focus:outline-none focus:border-tft-accent w-16 sm:w-20"
          />
        </div>
        <span className="text-xs text-tft-muted ml-auto">{rows.length} players</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-tft-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-tft-surface/80 text-tft-muted text-xs uppercase tracking-wider">
              {columns.map((col) => (
                <th
                  key={col.label}
                  onClick={col.key ? () => handleSort(col.key!) : undefined}
                  className={`${col.align} px-2 sm:px-4 py-2 sm:py-2.5 font-medium whitespace-nowrap ${
                    col.key
                      ? "cursor-pointer select-none hover:text-tft-text transition-colors"
                      : ""
                  } ${col.key && sort === col.key ? "text-tft-accent" : ""}`}
                >
                  {col.label}{sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-tft-border/50">
            {rows.map((p, idx) => (
              <tr
                key={`${p.game_name}#${p.tag_line}`}
                className="hover:bg-tft-hover/50 transition-colors"
              >
                <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-tft-muted">{idx + 1}</td>
                <td className="px-2 sm:px-4 py-2 sm:py-2.5 font-medium">
                  <span
                    onClick={() => router.push(`/player/${encodeURIComponent(p.game_name)}`)}
                    className="text-tft-text underline decoration-tft-muted/50 hover:decoration-tft-accent hover:text-tft-accent cursor-pointer transition-colors"
                  >
                    {p.game_name}
                  </span>
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-center text-tft-muted">{p.games}</td>
                <td className={`px-2 sm:px-4 py-2 sm:py-2.5 text-center font-semibold ${avpTextColor(p.avg_placement)}`}>
                  {p.avg_placement.toFixed(2)}
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-center text-tft-muted">
                  {(p.win_rate * 100).toFixed(1)}%
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-center text-tft-muted">
                  {(p.top4_rate * 100).toFixed(1)}%
                </td>
                <td className="px-2 sm:px-4 py-2 sm:py-2.5">
                  <div className="flex gap-1">
                    {p.top_units.map((u) => (
                      <div
                        key={u.character_id}
                        className={`w-6 h-6 sm:w-7 sm:h-7 rounded border ${costBorderColor(u.cost)} overflow-hidden shrink-0`}
                        title={formatUnit(u.character_id)}
                      >
                        <img
                          src={unitImageUrl(u.character_id)}
                          alt={formatUnit(u.character_id)}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No players found.
        </div>
      )}
    </div>
  );
}
