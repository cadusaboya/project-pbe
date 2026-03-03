"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
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

interface ItemEntry {
  display_name: string;
  item_id: string;
}

interface ChampionSlot {
  character_id: string;
  name: string;
  cost: number;
  stars: number;
  items: ItemEntry[];
  score?: number;
}

interface PlacementRow {
  placement: number;
  player_name: string;
  level: number;
  champions: ChampionSlot[];
}

type UploadPhase = "upload" | "review" | "submitting" | "done";

interface ScrimUploadProps {
  champions: ChampionInfo[];
  itemAssets: Record<string, string>;
  itemNames: Record<string, string>;
  server: string;
}

// ── Helper: reverse item names map ─────────────────────────────────────

function buildItemOptions(
  itemNames: Record<string, string>,
): { id: string; name: string }[] {
  const seen = new Set<string>();
  const result: { id: string; name: string }[] = [];
  for (const [id, name] of Object.entries(itemNames)) {
    if (!name || name.startsWith("@") || name.startsWith("tft_item")) continue;
    if (!id.startsWith("TFT_Item_") && !id.startsWith("TFT16_Item_") && !id.startsWith("TFT7_Item_") && !id.startsWith("TFT4_Item_Ornn") && !id.startsWith("TFT5_Item_")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ id, name });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ── Subcomponents ──────────────────────────────────────────────────────

function StarToggle({
  stars,
  onChange,
}: {
  stars: number;
  onChange: (s: number) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`w-5 h-5 text-[10px] font-bold rounded transition-colors ${
            s === stars
              ? s === 3
                ? "bg-yellow-500/30 text-yellow-400 ring-1 ring-yellow-400/50"
                : "bg-tft-gold/20 text-tft-gold ring-1 ring-tft-gold/40"
              : "bg-tft-surface text-tft-muted hover:text-tft-text"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ChampionAutocomplete({
  champions,
  onSelect,
  onClose,
}: {
  champions: ChampionInfo[];
  onSelect: (c: ChampionInfo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query) return champions.slice(0, 20);
    const lower = query.toLowerCase();
    return champions
      .filter((c) => c.name.toLowerCase().includes(lower))
      .slice(0, 20);
  }, [query, champions]);

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
        placeholder="Search champion..."
        className="w-full px-3 py-2 bg-transparent text-tft-text text-sm border-b border-tft-border outline-none placeholder:text-tft-muted"
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((c, i) => (
          <button
            key={c.apiName}
            type="button"
            onClick={() => onSelect(c)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
              i === highlightIdx
                ? "bg-tft-hover text-tft-text"
                : "text-tft-text/80 hover:bg-tft-hover"
            }`}
          >
            <UnitImage
              characterId={c.apiName}
              cost={c.cost}
              size={24}
              borderWidth={1}
            />
            <span>{c.name}</span>
            <span className="text-tft-muted text-xs ml-auto">{c.cost}g</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-tft-muted">
            No champions found
          </div>
        )}
      </div>
    </div>
  );
}

function ItemAutocomplete({
  items,
  itemAssets,
  onSelect,
  onClose,
}: {
  items: { id: string; name: string }[];
  itemAssets: Record<string, string>;
  onSelect: (item: { id: string; name: string }) => void;
  onClose: () => void;
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
    return items.filter((i) => i.name.toLowerCase().includes(lower)).slice(0, 20);
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
        placeholder="Search item..."
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
            <ItemImage itemId={item.id} itemAssets={itemAssets} size={20} />
            <span>{item.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-tft-muted">
            No items found
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export default function ScrimUpload({
  champions,
  itemAssets,
  itemNames,
  server,
}: ScrimUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<UploadPhase>("upload");
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [matchTime, setMatchTime] = useState(() => {
    // Default to current time formatted as datetime-local value
    // We treat the input as America/Cuiaba time (UTC-4)
    const now = new Date();
    const cuiaba = new Date(now.getTime() - 4 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${cuiaba.getFullYear()}-${pad(cuiaba.getMonth() + 1)}-${pad(cuiaba.getDate())}T${pad(cuiaba.getHours())}:${pad(cuiaba.getMinutes())}`;
  });

  // Champion add dropdown state: which placement row is active
  const [addChampIdx, setAddChampIdx] = useState<number | null>(null);
  // Item add dropdown state: [placementIdx, champIdx]
  const [addItemTarget, setAddItemTarget] = useState<
    [number, number] | null
  >(null);

  const itemOptions = useMemo(
    () => buildItemOptions(itemNames),
    [itemNames],
  );

  const anyDropdownOpen = addChampIdx !== null || addItemTarget !== null;

  function closeAllDropdowns() {
    setAddChampIdx(null);
    setAddItemTarget(null);
  }

  // ── Upload handler ───────────────────────────────────────────────────

  const handleUpload = useCallback(
    async (file: File) => {
      setError(null);
      setPhase("submitting");

      const formData = new FormData();
      formData.append("image", file);

      try {
        const res = await fetch(backendUrl("/api/scrims/upload/"), {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error || `Upload failed (${res.status})`,
          );
        }
        const data = await res.json();

        const rows: PlacementRow[] = (
          data.placements as Array<{
            placement: number;
            player_name?: string;
            champions: Array<{
              character_id: string;
              name: string;
              cost: number;
              stars: number;
              items: Array<{ display_name: string; item_id: string }>;
              score: number;
            }>;
          }>
        ).map((p) => ({
          placement: p.placement,
          player_name: p.player_name || "",
          level: 8,
          champions: p.champions.map((c) => ({
            character_id: c.character_id,
            name: c.name,
            cost: c.cost,
            stars: c.stars,
            items: c.items,
            score: c.score,
          })),
        }));

        setPlacements(rows);
        setPhase("review");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setPhase("upload");
      }
    },
    [],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleUpload(file);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  // ── Editing helpers ──────────────────────────────────────────────────

  function updatePlacement(idx: number, updater: (row: PlacementRow) => PlacementRow) {
    setPlacements((prev) =>
      prev.map((r, i) => (i === idx ? updater(r) : r)),
    );
  }

  function updateChampion(
    pIdx: number,
    cIdx: number,
    updater: (c: ChampionSlot) => ChampionSlot,
  ) {
    updatePlacement(pIdx, (row) => ({
      ...row,
      champions: row.champions.map((c, i) =>
        i === cIdx ? updater(c) : c,
      ),
    }));
  }

  function removeChampion(pIdx: number, cIdx: number) {
    updatePlacement(pIdx, (row) => ({
      ...row,
      champions: row.champions.filter((_, i) => i !== cIdx),
    }));
  }

  function addChampion(pIdx: number, info: ChampionInfo) {
    updatePlacement(pIdx, (row) => ({
      ...row,
      champions: [
        ...row.champions,
        {
          character_id: info.apiName,
          name: info.name,
          cost: info.cost,
          stars: 1,
          items: [],
        },
      ],
    }));
    setAddChampIdx(null);
  }

  function addItem(
    pIdx: number,
    cIdx: number,
    item: { id: string; name: string },
  ) {
    updateChampion(pIdx, cIdx, (c) => ({
      ...c,
      items: [...c.items, { display_name: item.name, item_id: item.id }],
    }));
    setAddItemTarget(null);
  }

  function removeItem(pIdx: number, cIdx: number, iIdx: number) {
    updateChampion(pIdx, cIdx, (c) => ({
      ...c,
      items: c.items.filter((_, i) => i !== iIdx),
    }));
  }

  // ── Confirm handler ──────────────────────────────────────────────────

  async function handleConfirm() {
    setPhase("submitting");
    setError(null);

    // Convert Cuiaba time (UTC-4) to UTC ISO string
    const cuiabaDate = new Date(matchTime);
    const utcMs = cuiabaDate.getTime() + 4 * 60 * 60 * 1000;
    const gameDatetime = new Date(utcMs).toISOString();

    const body = {
      game_version: "16.6 Scrims",
      game_datetime: gameDatetime,
      placements: placements.map((p) => ({
        placement: p.placement,
        player_name: p.player_name || undefined,
        level: p.level,
        champions: p.champions.map((c) => ({
          character_id: c.character_id,
          stars: c.stars,
          items: c.items.map((i) => i.item_id).filter(Boolean),
        })),
      })),
    };

    try {
      const res = await fetch(backendUrl("/api/scrims/confirm/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Submission failed (${res.status})`);
      }
      const data = await res.json();
      setMatchId(data.match_id);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setPhase("review");
    }
  }

  // ── Render: Upload phase ─────────────────────────────────────────────

  if (phase === "upload") {
    return (
      <div className="space-y-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-tft-gold bg-tft-gold/5"
              : "border-tft-border hover:border-tft-muted"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-12 h-12 mx-auto text-tft-muted mb-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
          <p className="text-tft-text font-medium">
            Drop a lobby screenshot here
          </p>
          <p className="text-tft-muted text-sm mt-1">
            or click to browse files
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    );
  }

  // ── Render: Submitting phase ─────────────────────────────────────────

  if (phase === "submitting") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-tft-gold border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-tft-text">Processing...</p>
      </div>
    );
  }

  // ── Render: Done phase ───────────────────────────────────────────────

  if (phase === "done") {
    return (
      <div className="bg-tft-surface border border-tft-border rounded-xl p-8 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-900/30 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="w-6 h-6 text-green-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-tft-text">Match Saved</h2>
        <p className="text-tft-muted text-sm">
          Match ID: <code className="text-tft-text">{matchId}</code>
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={() => {
              setPlacements([]);
              setMatchId(null);
              setPhase("upload");
            }}
            className="px-4 py-2 rounded-lg bg-tft-surface border border-tft-border text-tft-text text-sm hover:bg-tft-hover transition-colors"
          >
            Upload Another
          </button>
          <button
            onClick={() => router.push("/scrims/games-feed")}
            className="px-4 py-2 rounded-lg bg-tft-gold/20 text-tft-gold text-sm font-medium hover:bg-tft-gold/30 transition-colors"
          >
            View Games Feed
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Review phase ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Transparent backdrop to close dropdowns on outside click */}
      {anyDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeAllDropdowns}
        />
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-tft-muted text-sm">
          Review the OCR results below. Add, remove, or correct champions, items,
          and star levels before confirming.
        </p>
        <button
          onClick={() => {
            setPlacements([]);
            setPhase("upload");
          }}
          className="text-sm text-tft-muted hover:text-tft-text transition-colors shrink-0 ml-4"
        >
          Re-upload
        </button>
      </div>

      {/* Match time (America/Cuiaba) */}
      <div className="flex items-center gap-3 bg-tft-surface border border-tft-border rounded-xl px-4 py-3">
        <label className="text-sm text-tft-muted whitespace-nowrap">
          Match time
          <span className="text-tft-muted/60 text-xs ml-1">(Cuiaba)</span>
        </label>
        <input
          type="datetime-local"
          value={matchTime}
          onChange={(e) => setMatchTime(e.target.value)}
          className="bg-tft-bg border border-tft-border rounded px-2 py-1 text-sm text-tft-text focus:outline-none focus:border-tft-accent/50 [color-scheme:dark]"
        />
      </div>

      {placements.map((row, pIdx) => (
        <div
          key={pIdx}
          className="bg-tft-surface border border-tft-border rounded-xl p-4 space-y-3"
        >
          {/* Header: placement + level */}
          <div className="flex items-center gap-3">
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                row.placement === 1
                  ? "bg-yellow-500/20 text-yellow-400"
                  : row.placement <= 4
                    ? "bg-tft-gold/10 text-tft-gold"
                    : "bg-tft-surface text-tft-muted"
              }`}
            >
              #{row.placement}
            </span>
            <input
              type="text"
              value={row.player_name}
              onChange={(e) =>
                updatePlacement(pIdx, (r) => ({
                  ...r,
                  player_name: e.target.value,
                }))
              }
              placeholder="Player name"
              className="bg-tft-bg border border-tft-border rounded px-2 py-0.5 text-xs text-tft-text w-32 placeholder:text-tft-muted"
            />
            <label className="flex items-center gap-1.5 text-xs text-tft-muted">
              Lvl
              <select
                value={row.level}
                onChange={(e) =>
                  updatePlacement(pIdx, (r) => ({
                    ...r,
                    level: parseInt(e.target.value),
                  }))
                }
                className="bg-tft-bg border border-tft-border rounded px-1.5 py-0.5 text-xs text-tft-text"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-tft-muted ml-auto">
              {row.champions.length} unit{row.champions.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Champions */}
          <div className="space-y-2">
            {row.champions.map((champ, cIdx) => (
              <div
                key={`${champ.character_id}-${cIdx}`}
                className="flex items-center gap-2 bg-tft-bg/50 rounded-lg px-3 py-2"
              >
                <UnitImage
                  characterId={champ.character_id}
                  cost={champ.cost}
                  size={36}
                  borderWidth={2}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-tft-text font-medium truncate">
                    {champ.name || formatUnit(champ.character_id)}
                  </span>
                  {champ.score !== undefined && champ.score > 0 && (
                    <span className="text-[10px] text-tft-muted">
                      OCR: {(champ.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                <StarToggle
                  stars={champ.stars}
                  onChange={(s) =>
                    updateChampion(pIdx, cIdx, (c) => ({
                      ...c,
                      stars: s,
                    }))
                  }
                />

                {/* Items */}
                <div className="flex items-center gap-1 ml-1">
                  {champ.items.map((item, iIdx) => (
                    <div
                      key={`${item.item_id}-${iIdx}`}
                      className="relative group"
                    >
                      <ItemImage
                        itemId={item.item_id}
                        itemAssets={itemAssets}
                        size={22}
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(pIdx, cIdx, iIdx)}
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-600 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Remove ${item.display_name}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {champ.items.length < 3 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setAddItemTarget(
                            addItemTarget &&
                              addItemTarget[0] === pIdx &&
                              addItemTarget[1] === cIdx
                              ? null
                              : [pIdx, cIdx],
                          )
                        }
                        className="w-5 h-5 rounded bg-tft-border/50 text-tft-muted hover:text-tft-text hover:bg-tft-border text-xs flex items-center justify-center transition-colors"
                        title="Add item"
                      >
                        +
                      </button>
                      {addItemTarget &&
                        addItemTarget[0] === pIdx &&
                        addItemTarget[1] === cIdx && (
                          <ItemAutocomplete
                            items={itemOptions}
                            itemAssets={itemAssets}
                            onSelect={(item) =>
                              addItem(pIdx, cIdx, item)
                            }
                            onClose={() => setAddItemTarget(null)}
                          />
                        )}
                    </div>
                  )}
                </div>

                {/* Remove champion */}
                <button
                  type="button"
                  onClick={() => removeChampion(pIdx, cIdx)}
                  className="ml-auto text-tft-muted hover:text-red-400 transition-colors shrink-0"
                  title="Remove champion"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="w-4 h-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add champion button */}
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setAddChampIdx(addChampIdx === pIdx ? null : pIdx)
              }
              className="flex items-center gap-1.5 text-xs text-tft-muted hover:text-tft-text transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add Champion
            </button>
            {addChampIdx === pIdx && (
              <ChampionAutocomplete
                champions={champions}
                onSelect={(c) => addChampion(pIdx, c)}
                onClose={() => setAddChampIdx(null)}
              />
            )}
          </div>
        </div>
      ))}

      {/* Confirm button */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={() => {
            setPlacements([]);
            setPhase("upload");
          }}
          className="px-4 py-2.5 rounded-lg bg-tft-surface border border-tft-border text-tft-text text-sm hover:bg-tft-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-6 py-2.5 rounded-lg bg-tft-gold/20 text-tft-gold text-sm font-semibold hover:bg-tft-gold/30 border border-tft-gold/30 transition-colors"
        >
          Confirm Match
        </button>
      </div>
    </div>
  );
}
