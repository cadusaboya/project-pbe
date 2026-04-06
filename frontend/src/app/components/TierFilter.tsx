"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  VALID_TIERS,
  VALID_TIERS_SET,
  TIER_LABELS,
  DEFAULT_PBE_TIER,
  DEFAULT_PBE_QUEUE,
  getServerFromPath,
} from "@/lib/constants";

/**
 * Multi-select tier dropdown for PBE pages.
 * Sits next to the VersionFilter. Default: Tier 1.
 * URL params: tier=tier1 or tier=tier1,tier2
 */
export default function TierFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const server = getServerFromPath(pathname);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only show on PBE
  if (server !== "pbe") return null;

  const rawTier = searchParams.get("tier") ?? DEFAULT_PBE_TIER;
  const selected = new Set(
    rawTier.split(",").filter((t) => VALID_TIERS_SET.has(t))
  );
  // Empty selection means all tiers
  const allSelected = selected.size === 0 || selected.size === VALID_TIERS.length;

  function apply(next: Set<string>) {
    const params = new URLSearchParams(searchParams.toString());
    // If all or none selected, remove tier param (= all tiers)
    if (next.size === 0 || next.size === VALID_TIERS.length) {
      params.delete("tier");
    } else {
      params.set("tier", [...next].join(","));
    }
    params.set("queue", DEFAULT_PBE_QUEUE);
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggle(tier: string) {
    // If all are selected, clicking one means "only deselect that one"
    const base = allSelected ? new Set(VALID_TIERS as readonly string[]) : new Set(selected);
    if (base.has(tier)) {
      base.delete(tier);
    } else {
      base.add(tier);
    }
    apply(base);
  }

  // Close on click outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const label = allSelected
    ? "All Tiers"
    : [...selected]
        .map((t) => TIER_LABELS[t] ?? t)
        .join(", ");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="bg-tft-surface border border-tft-border text-tft-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent transition-colors flex items-center gap-1.5 whitespace-nowrap"
      >
        {label}
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-tft-surface border border-tft-border rounded-lg shadow-xl z-30 min-w-[140px] py-1">
          {VALID_TIERS.map((tier) => (
            <label
              key={tier}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-tft-hover cursor-pointer text-sm text-tft-text"
            >
              <input
                type="checkbox"
                checked={allSelected || selected.has(tier)}
                onChange={() => toggle(tier)}
                className="accent-tft-gold w-3.5 h-3.5"
              />
              {TIER_LABELS[tier]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
