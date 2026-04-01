"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { UnitImage } from "./TftImage";
import { formatUnit } from "@/lib/tftUtils";

interface UnitPickerUnit {
  unit_name: string;
  cost: number;
}

export default function UnitPicker({
  units,
  onSelect,
  placeholder = "+ Add unit\u2026",
}: {
  units: UnitPickerUnit[];
  onSelect: (unitName: string) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? units.filter(
          (u) =>
            u.unit_name.toLowerCase().includes(q) ||
            formatUnit(u.unit_name).toLowerCase().includes(q)
        )
      : units;
    return list.slice(0, 20);
  }, [units, search]);

  useEffect(() => { setHighlightedIndex(0); }, [filtered]);
  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function pick(unitName: string) {
    onSelect(unitName);
    setSearch("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlightedIndex]) pick(filtered[highlightedIndex].unit_name); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex items-center gap-2 bg-tft-surface border border-tft-border rounded-md px-3 py-1.5 text-sm hover:border-tft-accent transition-colors min-w-[140px] sm:min-w-[180px] text-left"
      >
        <span className="text-tft-muted">{placeholder}</span>
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-52 sm:w-56 bg-tft-surface border border-tft-border rounded-md shadow-xl overflow-hidden">
          <div className="p-2 border-b border-tft-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search unit\u2026"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-tft-bg border border-tft-border text-tft-text placeholder-tft-muted rounded px-2 py-1 text-sm focus:outline-none focus:border-tft-accent"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.map((u, i) => (
              <button
                key={u.unit_name}
                onClick={() => pick(u.unit_name)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${i === highlightedIndex ? "bg-tft-hover" : "hover:bg-tft-hover"}`}
              >
                <UnitImage characterId={u.unit_name} cost={u.cost} size={20} borderWidth={1} className="rounded" />
                <span className="text-tft-text text-sm">{formatUnit(u.unit_name)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-tft-muted text-sm text-center">No units found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
