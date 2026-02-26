import { Suspense } from "react";
import { backendUrl } from "@/lib/backend";
import ItemsExplorer from "../../components/ItemsExplorer";
import { UnitStat } from "../../components/StatsTable";

async function fetchUnits(server?: string): Promise<UnitStat[]> {
  try {
    const url = new URL(backendUrl("/api/unit-stats/"));
    url.searchParams.set("sort", "games");
    if (server) url.searchParams.set("server", server);
    const res = await fetch(url.toString(), {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchVersions(server?: string): Promise<string[]> {
  try {
    const url = new URL(backendUrl("/api/versions/"));
    if (server) url.searchParams.set("server", server);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
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

  const [units, versions] = await Promise.all([fetchUnits(server), fetchVersions(server)]);

  return (
    <Suspense fallback={null}>
      <ItemsExplorer
        units={units}
        versions={versions}
        selectedVersion={gameVersion ?? ""}
        server={server}
      />
    </Suspense>
  );
}
