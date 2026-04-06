"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { backendUrl } from "@/lib/backend";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";
import { formatItemName, formatDate, displayPlayerName, placementBadge, placementStyle } from "@/lib/formatters";
import type { BoardUnit, LobbyParticipant, TraitInfo, UnitStat } from "@/lib/types";
import TraitChips from "./TraitChips";
import UnitPicker from "./UnitPicker";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SearchComp {
  match_id: string;
  game_datetime: string;
  game_version: string;
  placement: number;
  level: number;
  player: string;
  units: BoardUnit[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
  highlighted,
}: {
  unit: BoardUnit;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  highlighted?: boolean;
}) {
  const traitTitle = unit.traits.length
    ? `${formatUnit(unit.character_id)} — ${unit.traits.join(", ")}`
    : formatUnit(unit.character_id);

  return (
    <div className={`relative rounded-lg ${highlighted ? "ring-1 ring-tft-gold/50" : ""}`} title={traitTitle}>
      <UnitImage
        characterId={unit.character_id}
        cost={unit.cost}
        size={48}
        className={`block rounded ${highlighted ? "!border-tft-gold" : ""}`}
      />
      <div className="absolute -top-3 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-3 left-0 right-0 flex justify-center z-10 pointer-events-none pb-0.5">
          {unit.items.map((item, i) => (
            <ItemImage key={i} itemId={item} itemAssets={itemAssets} size={16} className="rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitChipSmall({
  unit,
  itemAssets,
  itemNames,
}: {
  unit: BoardUnit;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
}) {
  return (
    <div
      className="relative rounded"
      title={`${formatUnit(unit.character_id)}${unit.traits.length ? ` — ${unit.traits.join(", ")}` : ""}`}
    >
      <UnitImage characterId={unit.character_id} cost={unit.cost} size={32} className="block rounded" />
      <div className="absolute -top-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <StarLevel level={unit.star_level} />
      </div>
      {unit.items.length > 0 && (
        <div className="absolute -bottom-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
          {unit.items.slice(0, 3).map((item, i) => (
            <ItemImage key={i} itemId={item} itemAssets={itemAssets} size={12} className="rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  comp,
  itemAssets,
  itemNames,
  traitData,
  searchedUnits,
  server,
}: {
  comp: SearchComp;
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  searchedUnits: string[];
  server: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lobby, setLobby] = useState<LobbyParticipant[] | null>(null);
  const [loadingLobby, setLoadingLobby] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const sortedUnits = comp.units
    .slice()
    .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level);

  function isHighlighted(unit: BoardUnit): boolean {
    return searchedUnits.some((q) =>
      unit.character_id.toLowerCase().includes(q.toLowerCase())
    );
  }

  async function handleToggle() {
    if (!expanded && !lobby) {
      setLoadingLobby(true);
      setLobbyError(null);
      try {
        const res = await fetch(`/api/match/${comp.match_id}/lobby/?server=${encodeURIComponent(server)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLobby(await res.json());
      } catch (e) {
        setLobbyError(e instanceof Error ? e.message : "Error loading lobby");
      } finally {
        setLoadingLobby(false);
      }
    }
    setExpanded((v) => !v);
  }

  return (
    <div className="border border-tft-border rounded-xl bg-tft-surface/60 overflow-hidden">
      {/* Clickable header */}
      <div
        className="p-3 sm:p-4 space-y-3 cursor-pointer select-none hover:bg-tft-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-sm font-bold shrink-0 ${placementBadge(comp.placement)}`}
          >
            #{comp.placement}
          </span>
          <a
            href={`/${server.toLowerCase()}/player/${encodeURIComponent(comp.player.split("#")[0])}`}
            onClick={(e) => e.stopPropagation()}
            className="text-tft-text font-medium hover:text-tft-gold transition-colors"
          >
            {displayPlayerName(comp.player)}
          </a>
          <span className="text-tft-muted text-xs">{formatDate(comp.game_datetime)}</span>
          {comp.game_version && (
            <span className="px-1.5 py-0.5 rounded bg-tft-surface border border-tft-border text-tft-muted text-xs">
              {comp.game_version}
            </span>
          )}
          <span className="text-tft-muted text-xs">Lvl {comp.level}</span>
          <span className="text-tft-muted text-xs ml-auto">{expanded ? "▲" : "▼"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sortedUnits.map((unit, i) => (
            <UnitChip
              key={i}
              unit={unit}
              itemAssets={itemAssets}
              itemNames={itemNames}
              highlighted={isHighlighted(unit)}
            />
          ))}
        </div>
        <TraitChips units={comp.units} traitData={traitData} />
      </div>

      {/* Expanded lobby */}
      {expanded && (
        <div className="border-t border-tft-border px-3 sm:px-4 py-3 space-y-1">
          <p className="text-tft-muted text-xs font-semibold uppercase tracking-wide pb-1">Full match results</p>
          {loadingLobby && (
            <p className="text-tft-muted text-sm text-center py-4">Loading lobby…</p>
          )}
          {lobbyError && (
            <p className="text-red-400 text-sm text-center py-4">{lobbyError}</p>
          )}
          {lobby && lobby.map((participant, i, arr) => {
            const isCurrentPlayer =
              participant.placement === comp.placement &&
              displayPlayerName(participant.name) === displayPlayerName(comp.player);
            return (
              <div
                key={i}
                className={`py-1.5 ${i < arr.length - 1 ? "border-b border-tft-border/40" : ""} ${isCurrentPlayer ? "bg-tft-accent/5 rounded" : ""}`}
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className={`w-5 text-sm text-right shrink-0 ${placementStyle(participant.placement)}`}>
                    #{participant.placement}
                  </span>
                  <a
                    href={`/${server.toLowerCase()}/player/${encodeURIComponent(participant.name.split("#")[0])}`}
                    onClick={(e) => e.stopPropagation()}
                    className={`text-sm w-24 sm:w-36 truncate shrink-0 hover:text-tft-gold transition-colors ${isCurrentPlayer ? "text-tft-accent font-semibold" : "text-tft-text"}`}
                  >
                    {displayPlayerName(participant.name)}
                  </a>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <TraitChips units={participant.units} traitData={traitData} />
                    <div className="flex flex-wrap gap-1">
                      {participant.units
                        .slice()
                        .sort((a, b) => b.cost - a.cost || b.star_level - a.star_level)
                        .map((unit, j) => (
                          <UnitChipSmall key={j} unit={unit} itemAssets={itemAssets} itemNames={itemNames} />
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SearchComps({
  units,
  itemAssets,
  itemNames,
  traitData,
  server,
  tier,
}: {
  units: UnitStat[];
  itemAssets: Record<string, string>;
  itemNames?: Record<string, string>;
  traitData: Record<string, TraitInfo>;
  server: string;
  tier?: string;
}) {
  const [requiredUnits, setRequiredUnits] = useState<string[]>([]);
  const [sort, setSort] = useState<"recency" | "placement">("recency");
  const [results, setResults] = useState<SearchComp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitMap = useMemo(
    () => Object.fromEntries(units.map((u) => [u.unit_name, u])),
    [units]
  );

  const fetchResults = useCallback(
    async (selectedUnits: string[], sortMode: string) => {
      if (selectedUnits.length === 0) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const url = new URL(backendUrl("/api/search-comps/"));
        for (const u of selectedUnits) url.searchParams.append("unit", u);
        url.searchParams.set("sort", sortMode);
        url.searchParams.set("server", server);
        if (tier) url.searchParams.set("tier", tier);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setResults(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error fetching results");
      } finally {
        setLoading(false);
      }
    },
    [server, tier]
  );

  useEffect(() => {
    fetchResults(requiredUnits, sort);
  }, [requiredUnits, sort, fetchResults]);

  function addUnit(unitName: string) {
    if (requiredUnits.includes(unitName)) return;
    setRequiredUnits((prev) => [...prev, unitName]);
  }

  function removeUnit(unitName: string) {
    setRequiredUnits((prev) => prev.filter((u) => u !== unitName));
  }

  return (
    <div className="space-y-6">
      {/* Unit selector */}
      <div className="bg-tft-surface border border-tft-border rounded-xl p-4 space-y-3">
        <p className="text-tft-text text-sm font-semibold">Add required unit</p>
        <div className="flex flex-wrap gap-2 items-center">
          <UnitPicker units={units} onSelect={addUnit} />
        </div>

        {/* Selected unit tags */}
        {requiredUnits.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center pt-1">
            {requiredUnits.map((unitName) => {
              const info = unitMap[unitName];
              return (
                <div
                  key={unitName}
                  className="flex items-center gap-2 border border-green-600 bg-green-950/40 rounded-lg px-3 py-1.5 text-sm"
                >
                  <UnitImage characterId={unitName} cost={info?.cost ?? 0} size={18} borderWidth={1} className="rounded" />
                  <span className="text-tft-text font-medium">{formatUnit(unitName)}</span>
                  <button
                    onClick={() => removeUnit(unitName)}
                    className="text-tft-muted hover:text-tft-text text-base leading-none ml-0.5"
                    aria-label={`Remove ${formatUnit(unitName)}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setRequiredUnits([])}
              className="text-tft-muted hover:text-red-400 text-xs px-2 py-1.5 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Sort controls */}
      {requiredUnits.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-tft-muted text-xs">Sort by:</span>
          <button
            onClick={() => setSort("recency")}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              sort === "recency"
                ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
            }`}
          >
            Most Recent
          </button>
          <button
            onClick={() => setSort("placement")}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              sort === "placement"
                ? "bg-tft-accent/20 border-tft-accent text-tft-accent"
                : "bg-tft-surface border-tft-border text-tft-muted hover:text-tft-text"
            }`}
          >
            Best Placement
          </button>
          {!loading && (
            <span className="text-tft-muted text-sm ml-auto">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
        </div>
      ) : requiredUnits.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Add one or more units above to search across all recorded comps.
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          No comps found with {requiredUnits.map(formatUnit).join(" + ")}.
        </div>
      ) : (
        <div className="grid gap-4">
          {results.map((comp, i) => (
            <ResultCard
              key={`${comp.match_id}-${comp.placement}-${i}`}
              comp={comp}
              itemAssets={itemAssets}
              itemNames={itemNames}
              traitData={traitData}
              searchedUnits={requiredUnits}
              server={server}
            />
          ))}
        </div>
      )}
    </div>
  );
}
