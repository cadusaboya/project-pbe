"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export default function VersionFilter({
  versions,
  selectedVersion,
}: {
  versions: string[];
  selectedVersion: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  function handleChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("game_version", v);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (versions.length === 0) return null;

  return (
    <select
      value={selectedVersion}
      onChange={(e) => handleChange(e.target.value)}
      className="bg-tft-surface border border-tft-border text-tft-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-tft-accent transition-colors"
    >
      <option value="">All versions</option>
      {versions.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
}
