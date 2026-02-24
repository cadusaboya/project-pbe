"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const SERVERS = [
  { value: "PBE", label: "PBE" },
  { value: "LIVE", label: "Live" },
] as const;

export default function ServerSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const current = (searchParams.get("server") ?? "PBE").toUpperCase();

  function handleChange(server: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (server === "PBE") {
      params.delete("server");
    } else {
      params.set("server", server);
    }
    // Clear game_version when switching servers (versions differ)
    params.delete("game_version");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
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
              : "text-tft-muted hover:text-tft-text"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
