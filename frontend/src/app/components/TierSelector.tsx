"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { VALID_TIERS_SET, getServerFromPath, DEFAULT_PBE_QUEUE, DEFAULT_PBE_TIER } from "@/lib/constants";

/**
 * Combined queue + tier selector for PBE.
 *
 * Buttons: [ T1 ] [ T2 ] [ Open ] [ Random Q ]
 *
 * T1/T2/Open → queue=project_pbe&tier=tierX
 * Random Q   → queue=pro_random  (no tier)
 */

const OPTIONS = [
  { queue: "project_pbe", tier: "tier1", label: "T1" },
  { queue: "project_pbe", tier: "tier2", label: "T2" },
  { queue: "project_pbe", tier: "open", label: "Open" },
  { queue: "pro_random", tier: "", label: "Random Q" },
] as const;

export default function TierSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const server = getServerFromPath(pathname);

  // Only show on PBE
  if (server !== "pbe") return null;

  const currentQueue = searchParams.get("queue") ?? DEFAULT_PBE_QUEUE;
  const currentTier = searchParams.get("tier") ?? (currentQueue === "project_pbe" ? DEFAULT_PBE_TIER : "");

  function handleChange(queue: string, tier: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("queue", queue);
    if (tier && VALID_TIERS_SET.has(tier)) {
      params.set("tier", tier);
    } else {
      params.delete("tier");
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex gap-0.5 bg-tft-surface border border-tft-border rounded-lg p-0.5">
      {OPTIONS.map((opt) => {
        const isActive = currentQueue === opt.queue && currentTier === opt.tier;
        return (
          <button
            key={`${opt.queue}-${opt.tier}`}
            onClick={() => handleChange(opt.queue, opt.tier)}
            className={`px-2 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              isActive
                ? "bg-tft-gold/20 text-tft-gold shadow-sm"
                : "text-tft-text/70 hover:text-tft-text"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
