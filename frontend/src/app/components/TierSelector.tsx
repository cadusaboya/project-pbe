"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { VALID_TIERS_SET, TIER_LABELS, getServerFromPath } from "@/lib/constants";

const TIERS = [
  { value: "", label: "All" },
  { value: "tier1", label: "Tier 1" },
  { value: "tier2", label: "Tier 2" },
  { value: "open", label: "Open" },
] as const;

export default function TierSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const server = getServerFromPath(pathname);

  // Only show on PBE
  if (server !== "pbe") return null;

  const current = searchParams.get("tier") ?? "";

  function handleChange(tier: string) {
    const params = new URLSearchParams(searchParams.toString());
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
      {TIERS.map((t) => (
        <button
          key={t.value}
          onClick={() => handleChange(t.value)}
          className={`px-2 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
            current === t.value
              ? "bg-tft-gold/20 text-tft-gold shadow-sm"
              : "text-tft-text/70 hover:text-tft-text"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
