"use client";

import { useRouter, usePathname } from "next/navigation";

const VALID_SERVERS = ["pbe", "live", "scrims"];

const SERVERS = [
  { value: "pbe", label: "PBE" },
  { value: "live", label: "Live" },
] as const;

export default function ServerSelector() {
  const router = useRouter();
  const pathname = usePathname();

  // Extract current server from path: /pbe/comps → "pbe"
  const first = pathname.split("/")[1]?.toLowerCase();
  const current = VALID_SERVERS.includes(first ?? "") ? first! : "pbe";

  function handleChange(newServer: string) {
    // Replace the server segment in the path, drop query params (versions differ)
    const rest = VALID_SERVERS.includes(first ?? "")
      ? pathname.slice(first!.length + 1) // strip /<server>
      : pathname; // on landing page or unknown path
    router.push(`/${newServer}${rest || "/comps"}`);
  }

  return (
    <div className="flex gap-0.5 bg-tft-surface border border-tft-border rounded-lg p-0.5">
      {SERVERS.map((s) => (
        <button
          key={s.value}
          onClick={() => handleChange(s.value)}
          className={`px-2.5 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-all ${
            current === s.value
              ? "bg-tft-gold/20 text-tft-gold shadow-sm"
              : "text-tft-text/70 hover:text-tft-text"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
