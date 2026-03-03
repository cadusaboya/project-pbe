"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { backendUrl } from "@/lib/backend";
import { UnitImage, ItemImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";

// ── Types ──────────────────────────────────────────────────────────────

interface ChampionInfo {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

interface UnitData {
  usage_id: number;
  character_id: string;
  star_level: number;
  cost: number;
  items: string[];
}

interface ParticipantData {
  participant_id: number;
  player_name: string;
  placement: number;
  level: number;
  units: UnitData[];
}

interface LobbyData {
  match_id: string;
  server: string;
  game_datetime: string;
  game_version: string;
  participants: ParticipantData[];
}

interface MatchResult {
  match_id: string;
  game_datetime: string;
  placement: number;
  level: number;
  units: {
    character_id: string;
    star_level: number;
    cost: number;
    items: string[];
  }[];
}

interface MatchEditorProps {
  champions: ChampionInfo[];
  itemAssets: Record<string, string>;
  itemNames: Record<string, string>;
  server: string;
}

// ── Helper: build item options ──────────────────────────────────────────

function buildItemOptions(
  itemNames: Record<string, string>,
): { id: string; name: string }[] {
  const seen = new Set<string>();
  const result: { id: string; name: string }[] = [];
  for (const [id, name] of Object.entries(itemNames)) {
    if (!name || name.startsWith("@") || name.startsWith("tft_item")) continue;
    if (!/^TFT\d*_Item_/.test(id)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ id, name });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ── Generic Autocomplete ────────────────────────────────────────────────

function Autocomplete<T extends { id: string; label: string }>({
  items,
  onSelect,
  onClose,
  placeholder,
  renderItem,
}: {
  items: T[];
  onSelect: (item: T) => void;
  onClose: () => void;
  placeholder: string;
  renderItem: (item: T, highlighted: boolean) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 20);
    const lower = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(lower)).slice(0, 20);
  }, [query, items]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[highlightIdx]) {
      e.preventDefault();
      onSelect(filtered[highlightIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="absolute z-50 mt-1 w-64 bg-tft-surface border border-tft-border rounded-lg shadow-xl overflow-hidden">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightIdx(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-transparent text-tft-text text-sm border-b border-tft-border outline-none placeholder:text-tft-muted"
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
              i === highlightIdx
                ? "bg-tft-hover text-tft-text"
                : "text-tft-text/80 hover:bg-tft-hover"
            }`}
          >
            {renderItem(item, i === highlightIdx)}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-tft-muted">No results</div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export default function MatchEditor({
  champions,
  itemAssets,
  itemNames,
  server,
}: MatchEditorProps) {
  const [playerSearch, setPlayerSearch] = useState("");
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState<number | null>(null);
  const [addingUnit, setAddingUnit] = useState<number | null>(null);
  const [editingDatetime, setEditingDatetime] = useState(false);
  const [datetimeValue, setDatetimeValue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const itemOptions = useMemo(
    () =>
      buildItemOptions(itemNames).map((i) => ({
        id: i.id,
        label: i.name,
        name: i.name,
      })),
    [itemNames],
  );

  const championOptions = useMemo(
    () =>
      champions
        .map((c) => ({
          id: c.apiName,
          label: c.name,
          cost: c.cost,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [champions],
  );

  // ── API helpers ─────────────────────────────────────────────────────

  const flash = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 2000);
  }, []);

  const searchPlayer = useCallback(async () => {
    if (!playerSearch.trim()) return;
    setLoading(true);
    setError("");
    setMatches([]);
    setLobby(null);
    try {
      const res = await fetch(
        backendUrl(
          `/api/player/${encodeURIComponent(playerSearch.trim())}/profile/?server=${server}`,
        ),
      );
      if (!res.ok) {
        setError(res.status === 404 ? "Player not found" : "Failed to fetch player");
        return;
      }
      const data = await res.json();
      setMatches(data.match_history || []);
      if (!data.match_history?.length) setError("No matches found for this player");
    } catch {
      setError("Failed to fetch player data");
    } finally {
      setLoading(false);
    }
  }, [playerSearch, server]);

  const loadMatch = useCallback(async (matchId: string) => {
    setLoading(true);
    setError("");
    setLobby(null);
    try {
      const res = await fetch(backendUrl(`/api/match/${matchId}/edit-lobby/`));
      if (!res.ok) {
        setError("Failed to load match");
        return;
      }
      const data: LobbyData = await res.json();
      setLobby(data);
    } catch {
      setError("Failed to load match");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Unit items ────────────────────────────────────────────────────────

  const patchUsage = useCallback(
    async (usageId: number, body: Record<string, unknown>) => {
      setSaving(usageId);
      try {
        const res = await fetch(backendUrl(`/api/unit-usage/${usageId}/items/`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setError("Failed to save");
          return null;
        }
        const data = await res.json();
        setLobby((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.map((p) => ({
              ...p,
              units: p.units.map((u) =>
                u.usage_id === usageId
                  ? { ...u, items: data.items, star_level: data.star_level }
                  : u,
              ),
            })),
          };
        });
        return data;
      } catch {
        setError("Failed to save");
        return null;
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const addItem = useCallback(
    async (usageId: number, itemId: string) => {
      const unit = lobby?.participants
        .flatMap((p) => p.units)
        .find((u) => u.usage_id === usageId);
      if (!unit) return;
      const data = await patchUsage(usageId, { items: [...unit.items, itemId] });
      if (data) flash(`Added item to ${formatUnit(data.character_id)}`);
      setAddingItem(null);
    },
    [lobby, patchUsage, flash],
  );

  const removeItem = useCallback(
    async (usageId: number, itemIndex: number) => {
      const unit = lobby?.participants
        .flatMap((p) => p.units)
        .find((u) => u.usage_id === usageId);
      if (!unit) return;
      const data = await patchUsage(usageId, {
        items: unit.items.filter((_, i) => i !== itemIndex),
      });
      if (data) flash(`Removed item from ${formatUnit(data.character_id)}`);
    },
    [lobby, patchUsage, flash],
  );

  // ── Star level ────────────────────────────────────────────────────────

  const cycleStar = useCallback(
    async (usageId: number, current: number) => {
      const next = current >= 3 ? 1 : current + 1;
      const data = await patchUsage(usageId, { star_level: next });
      if (data) flash(`${formatUnit(data.character_id)} -> ${next}*`);
    },
    [patchUsage, flash],
  );

  // ── Remove unit ───────────────────────────────────────────────────────

  const removeUnit = useCallback(
    async (usageId: number) => {
      setSaving(usageId);
      try {
        const res = await fetch(backendUrl(`/api/unit-usage/${usageId}/items/`), {
          method: "DELETE",
        });
        if (!res.ok) {
          setError("Failed to delete unit");
          return;
        }
        const data = await res.json();
        setLobby((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.map((p) => ({
              ...p,
              units: p.units.filter((u) => u.usage_id !== usageId),
            })),
          };
        });
        flash(`Removed ${formatUnit(data.deleted)}`);
      } catch {
        setError("Failed to delete unit");
      } finally {
        setSaving(null);
      }
    },
    [flash],
  );

  // ── Add unit ──────────────────────────────────────────────────────────

  const addUnit = useCallback(
    async (participantId: number, characterId: string) => {
      if (!lobby) return;
      setAddingUnit(null);
      try {
        const res = await fetch(
          backendUrl(`/api/match/${lobby.match_id}/add-unit/`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participant_id: participantId,
              character_id: characterId,
              star_level: 1,
            }),
          },
        );
        if (!res.ok) {
          setError("Failed to add unit");
          return;
        }
        const data = await res.json();
        setLobby((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.map((p) =>
              p.participant_id === participantId
                ? { ...p, units: [...p.units, data] }
                : p,
            ),
          };
        });
        flash(`Added ${formatUnit(data.character_id)}`);
      } catch {
        setError("Failed to add unit");
      }
    },
    [lobby, flash],
  );

  // ── Edit match datetime ───────────────────────────────────────────────

  const saveDateTime = useCallback(async () => {
    if (!lobby || !datetimeValue) return;
    try {
      const res = await fetch(backendUrl(`/api/match/${lobby.match_id}/edit/`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_datetime: new Date(datetimeValue).toISOString() }),
      });
      if (!res.ok) {
        setError("Failed to update datetime");
        return;
      }
      const data = await res.json();
      setLobby((prev) =>
        prev ? { ...prev, game_datetime: data.game_datetime } : prev,
      );
      setEditingDatetime(false);
      flash("Match time updated");
    } catch {
      setError("Failed to update datetime");
    }
  }, [lobby, datetimeValue, flash]);

  // Open datetime editor with current value
  const openDatetimeEditor = useCallback(() => {
    if (!lobby) return;
    // Format for datetime-local input
    const dt = new Date(lobby.game_datetime);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setDatetimeValue(local);
    setEditingDatetime(true);
  }, [lobby]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          value={playerSearch}
          onChange={(e) => setPlayerSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchPlayer()}
          placeholder="Player name (e.g. VIT setsuko)"
          className="flex-1 px-4 py-2 bg-tft-surface border border-tft-border rounded-lg text-tft-text text-sm placeholder:text-tft-muted outline-none focus:border-tft-accent"
        />
        <button
          onClick={searchPlayer}
          disabled={loading}
          className="px-4 py-2 bg-tft-accent text-black font-semibold text-sm rounded-lg hover:bg-tft-gold transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}
      {success && <div className="text-green-400 text-sm">{success}</div>}

      {/* Match list */}
      {matches.length > 0 && !lobby && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-tft-muted uppercase tracking-wide">
            Recent Matches ({matches.length})
          </h2>
          <div className="space-y-1">
            {matches.map((m) => (
              <button
                key={m.match_id}
                onClick={() => loadMatch(m.match_id)}
                className="w-full flex items-center gap-3 px-3 py-2 bg-tft-surface border border-tft-border rounded-lg hover:bg-tft-hover transition-colors text-left"
              >
                <span
                  className={`text-sm font-bold w-6 text-center ${
                    m.placement <= 4 ? "text-tft-gold" : "text-tft-muted"
                  }`}
                >
                  #{m.placement}
                </span>
                <span className="text-xs text-tft-muted">Lv{m.level}</span>
                <div className="flex gap-0.5">
                  {[...m.units]
                    .sort((a, b) => b.cost - a.cost)
                    .map((u, i) => (
                      <UnitImage
                        key={i}
                        characterId={u.character_id}
                        cost={u.cost}
                        size={28}
                        borderWidth={1}
                      />
                    ))}
                </div>
                <span className="ml-auto text-xs text-tft-muted">
                  {new Date(m.game_datetime).toLocaleDateString()}
                </span>
                <span className="text-xs text-tft-muted font-mono">
                  {m.match_id}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lobby editor */}
      {lobby && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-tft-text">
                {lobby.match_id}
              </h2>
              <div className="flex items-center gap-1 text-xs text-tft-muted">
                <span>{lobby.server}</span>
                <span>&middot;</span>
                <span>{lobby.game_version}</span>
                <span>&middot;</span>
                {editingDatetime ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="datetime-local"
                      value={datetimeValue}
                      onChange={(e) => setDatetimeValue(e.target.value)}
                      className="bg-tft-bg border border-tft-border rounded px-1 py-0.5 text-tft-text text-xs"
                    />
                    <button
                      onClick={saveDateTime}
                      className="text-green-400 hover:text-green-300 font-semibold"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingDatetime(false)}
                      className="text-tft-muted hover:text-tft-text"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={openDatetimeEditor}
                    className="hover:text-tft-accent underline decoration-dotted"
                    title="Edit match time"
                  >
                    {new Date(lobby.game_datetime).toLocaleString()}
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => setLobby(null)}
              className="text-xs text-tft-muted hover:text-tft-text"
            >
              Back to matches
            </button>
          </div>

          {/* Participants */}
          {lobby.participants.map((p) => (
            <div
              key={p.participant_id}
              className="bg-tft-surface border border-tft-border rounded-lg p-3"
            >
              {/* Player header */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-sm font-bold ${
                    p.placement <= 4 ? "text-tft-gold" : "text-tft-muted"
                  }`}
                >
                  #{p.placement}
                </span>
                <span className="text-sm text-tft-text font-medium">
                  {p.player_name}
                </span>
                <span className="text-xs text-tft-muted">Lv{p.level}</span>
              </div>

              {/* Units */}
              <div className="space-y-1.5">
                {[...p.units]
                  .sort((a, b) => b.cost - a.cost)
                  .map((u) => (
                    <div
                      key={u.usage_id}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      {/* Unit image */}
                      <UnitImage
                        characterId={u.character_id}
                        cost={u.cost}
                        size={36}
                        borderWidth={1}
                      />

                      {/* Name + star (click star to cycle) */}
                      <span className="text-xs text-tft-text w-20 truncate">
                        {formatUnit(u.character_id)}{" "}
                        <button
                          onClick={() => cycleStar(u.usage_id, u.star_level)}
                          className="text-tft-muted hover:text-tft-gold transition-colors"
                          title="Click to change star level"
                        >
                          {u.star_level}*
                        </button>
                      </span>

                      {/* Items */}
                      <div className="flex items-center gap-1">
                        {u.items.map((itemId, ii) => (
                          <button
                            key={ii}
                            onClick={() => removeItem(u.usage_id, ii)}
                            className="relative group"
                            title={`Remove ${itemNames[itemId] || itemId}`}
                          >
                            <ItemImage
                              itemId={itemId}
                              itemAssets={itemAssets}
                              size={24}
                            />
                            <div className="absolute inset-0 bg-red-500/0 group-hover:bg-red-500/40 rounded transition-colors flex items-center justify-center">
                              <span className="text-white text-xs font-bold opacity-0 group-hover:opacity-100">
                                x
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Add item */}
                      <div className="relative">
                        <button
                          onClick={() =>
                            setAddingItem(
                              addingItem === u.usage_id ? null : u.usage_id,
                            )
                          }
                          disabled={saving === u.usage_id}
                          className="w-6 h-6 rounded border border-dashed border-tft-border hover:border-tft-accent text-tft-muted hover:text-tft-accent text-xs flex items-center justify-center transition-colors"
                          title="Add item"
                        >
                          {saving === u.usage_id ? "..." : "+"}
                        </button>
                        {addingItem === u.usage_id && (
                          <Autocomplete
                            items={itemOptions}
                            placeholder="Search item..."
                            onSelect={(item) => addItem(u.usage_id, item.id)}
                            onClose={() => setAddingItem(null)}
                            renderItem={(item) => (
                              <>
                                <ItemImage
                                  itemId={item.id}
                                  itemAssets={itemAssets}
                                  size={20}
                                />
                                <span>{item.label}</span>
                              </>
                            )}
                          />
                        )}
                      </div>

                      {/* Remove unit */}
                      <button
                        onClick={() => removeUnit(u.usage_id)}
                        className="ml-auto w-5 h-5 rounded text-tft-muted/40 hover:text-red-400 hover:bg-red-500/10 text-xs flex items-center justify-center transition-colors"
                        title={`Remove ${formatUnit(u.character_id)}`}
                      >
                        x
                      </button>
                    </div>
                  ))}

                {/* Add unit button */}
                <div className="relative pt-1">
                  <button
                    onClick={() =>
                      setAddingUnit(
                        addingUnit === p.participant_id
                          ? null
                          : p.participant_id,
                      )
                    }
                    className="flex items-center gap-1 text-xs text-tft-muted hover:text-tft-accent transition-colors"
                  >
                    <span className="w-5 h-5 rounded border border-dashed border-tft-border flex items-center justify-center text-[10px]">
                      +
                    </span>
                    Add unit
                  </button>
                  {addingUnit === p.participant_id && (
                    <Autocomplete
                      items={championOptions}
                      placeholder="Search champion..."
                      onSelect={(champ) =>
                        addUnit(p.participant_id, champ.id)
                      }
                      onClose={() => setAddingUnit(null)}
                      renderItem={(champ) => (
                        <>
                          <UnitImage
                            characterId={champ.id}
                            cost={champ.cost}
                            size={20}
                            borderWidth={1}
                          />
                          <span>{champ.label}</span>
                          <span className="text-tft-muted ml-auto">
                            {champ.cost}g
                          </span>
                        </>
                      )}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
