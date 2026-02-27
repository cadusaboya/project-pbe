import { Suspense } from "react";
import { fetchJson } from "@/lib/api";
import DataExplorer from "../../components/DataExplorer";
import PageSkeleton from "../../components/PageSkeleton";
import { UnitStat } from "../../components/StatsTable";

async function fetchUnits(server?: string): Promise<UnitStat[]> {
  try {
    const params = new URLSearchParams({ sort: "games" });
    if (server) params.set("server", server);
    return await fetchJson<UnitStat[]>(`/api/unit-stats/?${params}`);
  } catch {
    return [];
  }
}

async function fetchVersions(server?: string): Promise<string[]> {
  try {
    const params = new URLSearchParams();
    if (server) params.set("server", server);
    const qs = params.toString();
    return await fetchJson<string[]>(`/api/versions/${qs ? `?${qs}` : ""}`);
  } catch {
    return [];
  }
}

async function fetchTraits(): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    return await fetchJson<Record<string, { breakpoints: number[]; icon: string }>>("/api/traits/");
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

function buildInitialConditions(rawParams: RawParams) {
  return [
    ...toArray(rawParams.require_unit).map((unit) => ({ type: "require_unit" as const, unit })),
    ...toArray(rawParams.ban_unit).map((unit) => ({ type: "ban_unit" as const, unit })),
    ...toArray(rawParams.player_level).map((l) => ({ type: "player_level" as const, level: Number(l) })),
    ...toArray(rawParams.require_item_on_unit).map((v) => {
      const [unit, item] = v.split("::");
      return { type: "require_item_on_unit" as const, unit, item };
    }),
    ...toArray(rawParams.exclude_item).map((item) => ({ type: "exclude_item" as const, item })),
    ...toArray(rawParams.require_trait).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx > 0) {
        const trait = raw.slice(0, idx);
        const count = Number(raw.slice(idx + 1));
        return { type: "require_trait" as const, trait, count: isNaN(count) ? 1 : Math.max(1, count) };
      }
      return { type: "require_trait" as const, trait: raw, count: 1 };
    }),
    ...toArray(rawParams.exclude_unit_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 2);
      return { type: "exclude_unit_count" as const, unit, count };
    }),
    ...toArray(rawParams.require_unit_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 2);
      return { type: "require_unit_count" as const, unit, count };
    }),
    ...toArray(rawParams.require_unit_star).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx <= 0) return { type: "require_unit_star" as const, unit: raw, star: 2 };
      const star = Number(raw.slice(idx + 1));
      return { type: "require_unit_star" as const, unit: raw.slice(0, idx), star: isNaN(star) ? 2 : Math.max(1, Math.min(3, star)) };
    }),
    ...toArray(rawParams.require_unit_item_count).map((raw) => {
      const { unit, count } = parseUnitCount(raw, 3);
      return { type: "require_unit_item_count" as const, unit, itemCount: count };
    }),
    ...toArray(rawParams.exclude_trait).map((raw) => {
      const idx = raw.lastIndexOf(":");
      if (idx <= 0) return { type: "exclude_trait" as const, trait: raw, count: 1 };
      const count = Number(raw.slice(idx + 1));
      return { type: "exclude_trait" as const, trait: raw.slice(0, idx), count: isNaN(count) ? 1 : Math.max(1, count) };
    }),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ExploreContent({
  server,
  gameVersion,
  initialConditions,
}: {
  server: string;
  gameVersion: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialConditions: any[];
}) {
  const [units, versions, traitData] = await Promise.all([fetchUnits(server), fetchVersions(server), fetchTraits()]);

  return (
    <DataExplorer
      units={units}
      versions={versions}
      selectedVersion={gameVersion}
      initialConditions={initialConditions}
      traitData={traitData}
      server={server}
    />
  );
}

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<RawParams>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const rawParams = await searchParams;
  const gameVersion = rawParams.game_version ?? "";
  const initialConditions = buildInitialConditions(rawParams);

  return (
    <Suspense fallback={<PageSkeleton variant="explorer" />}>
      <ExploreContent
        server={server}
        gameVersion={gameVersion}
        initialConditions={initialConditions}
      />
    </Suspense>
  );
}
