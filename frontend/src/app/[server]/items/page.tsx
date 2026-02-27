import { Suspense } from "react";
import { fetchJson } from "@/lib/api";
import { getDefaultVersion } from "@/lib/api";
import ItemsExplorer from "../../components/ItemsExplorer";
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

async function ItemsContent({
  server,
  gameVersion,
}: {
  server: string;
  gameVersion: string;
}) {
  const [units, versions] = await Promise.all([fetchUnits(server), fetchVersions(server)]);

  return (
    <ItemsExplorer
      units={units}
      versions={versions}
      selectedVersion={gameVersion}
      server={server}
    />
  );
}

export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const { game_version: gameVersion } = await searchParams;

  return (
    <Suspense fallback={<PageSkeleton variant="explorer" />}>
      <ItemsContent server={server} gameVersion={gameVersion ?? await getDefaultVersion(server)} />
    </Suspense>
  );
}
