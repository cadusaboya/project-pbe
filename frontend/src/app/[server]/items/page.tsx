import { Suspense } from "react";
import { fetchJson } from "@/lib/api";
import { getDefaultVersion } from "@/lib/api";
import { DEFAULT_PBE_TIER, DEFAULT_PBE_QUEUE } from "@/lib/constants";
import ItemsExplorer from "../../components/ItemsExplorer";
import PageSkeleton from "../../components/PageSkeleton";
import { UnitStat } from "../../components/StatsTable";

async function fetchUnits(server?: string, tier?: string, queue?: string): Promise<UnitStat[]> {
  try {
    const params = new URLSearchParams({ sort: "games" });
    if (server) params.set("server", server);
    if (tier) params.set("tier", tier);
    if (queue) params.set("queue", queue);
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

async function ItemsContent({
  server,
  gameVersion,
  tier,
  queue,
}: {
  server: string;
  gameVersion: string;
  tier?: string;
  queue?: string;
}) {
  const [units, versions] = await Promise.all([fetchUnits(server, tier, queue), fetchVersions(server)]);

  return (
    <ItemsExplorer
      units={units}
      versions={versions}
      selectedVersion={gameVersion}
      server={server}
      tier={tier}
      queue={queue}
    />
  );
}

export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string; tier?: string; queue?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { game_version: gameVersion, tier: rawTier, queue: rawQueue } = await searchParams;
  const isPbe = server === "PBE";
  const tier = rawTier ?? (isPbe ? DEFAULT_PBE_TIER : undefined);
  const queue = rawQueue ?? (isPbe ? DEFAULT_PBE_QUEUE : undefined);

  return (
    <Suspense fallback={<PageSkeleton variant="explorer" />}>
      <ItemsContent server={server} gameVersion={gameVersion ?? await getDefaultVersion(server)} tier={tier} queue={queue} />
    </Suspense>
  );
}
