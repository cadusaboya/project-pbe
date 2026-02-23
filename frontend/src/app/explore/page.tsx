import { Suspense } from "react";
import { backendUrl } from "@/lib/backend";
import DataExplorer from "../components/DataExplorer";
import { UnitStat } from "../components/StatsTable";

async function fetchUnits(): Promise<UnitStat[]> {
  try {
    const res = await fetch(backendUrl("/api/unit-stats/?sort=games"), {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch(backendUrl("/api/versions/"), {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchTraits(): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    const res = await fetch(backendUrl("/api/traits/"), { next: { revalidate: 60 } });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

type RawParams = {
  game_version?: string;
  require_unit?: string | string[];
  ban_unit?: string | string[];
  player_level?: string | string[];
  require_item_on_unit?: string | string[];
  exclude_item?: string | string[];
  require_trait?: string | string[];
  exclude_unit_count?: string | string[];
  require_unit_count?: string | string[];
  require_unit_star?: string | string[];
  require_unit_item_count?: string | string[];
  exclude_trait?: string | string[];
};

function toArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseUnitCount(raw: string, defaultCount = 2) {
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) return { unit: raw, count: defaultCount };
  const count = Number(raw.slice(idx + 1));
  return { unit: raw.slice(0, idx), count: isNaN(count) ? defaultCount : Math.max(1, count) };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = await searchParams;
  const gameVersion = params.game_version ?? "";

  const initialConditions = [
    ...toArray(params.require_unit).map((unit) => ({ type: "require_unit" as const, unit })),
    ...toArray(params.ban_unit).map((unit) => ({ type: "ban_unit" as const, unit })),
    ...toArray(params.player_level).map((l) => ({ type: "player_level" as const, level: Number(l) })),
    ...toArray(params.require_item_on_unit).map((v) => {
      const [unit, item] = v.split("::");
      return { type: "require_item_on_unit" as const, unit, item };
    }),
    ...toArray(params.exclude_item).map((item) => ({ type: "exclude_item" as const, item })),
    ...toArray(params.require_trait).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx > 0) {
        const trait = raw.slice(0, idx);
        const count = Number(raw.slice(idx + 1));
        return { type: "require_trait" as const, trait, count: isNaN(count) ? 1 : Math.max(1, count) };
      }
      return { type: "require_trait" as const, trait: raw, count: 1 };
    }),
    ...toArray(params.exclude_unit_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 2);
      return { type: "exclude_unit_count" as const, unit, count };
    }),
    ...toArray(params.require_unit_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 2);
      return { type: "require_unit_count" as const, unit, count };
    }),
    ...toArray(params.require_unit_star).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx <= 0) return { type: "require_unit_star" as const, unit: raw, star: 2 };
      const star = Number(raw.slice(idx + 1));
      return { type: "require_unit_star" as const, unit: raw.slice(0, idx), star: isNaN(star) ? 2 : Math.max(1, Math.min(3, star)) };
    }),
    ...toArray(params.require_unit_item_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 3);
      return { type: "require_unit_item_count" as const, unit, itemCount: count };
    }),
    ...toArray(params.exclude_trait).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx <= 0) return { type: "exclude_trait" as const, trait: raw, count: 1 };
      const count = Number(raw.slice(idx + 1));
      return { type: "exclude_trait" as const, trait: raw.slice(0, idx), count: isNaN(count) ? 1 : Math.max(1, count) };
    }),
  ];

  const [units, versions, traitData] = await Promise.all([fetchUnits(), fetchVersions(), fetchTraits()]);

  return (
    <Suspense fallback={null}>
      <DataExplorer
        units={units}
        versions={versions}
        selectedVersion={gameVersion}
        initialConditions={initialConditions}
        traitData={traitData}
      />
    </Suspense>
  );
}
