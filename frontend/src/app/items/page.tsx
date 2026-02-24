import { Suspense } from "react";
import { backendUrl } from "@/lib/backend";
import ItemsExplorer from "../components/ItemsExplorer";
import { UnitStat } from "../components/StatsTable";

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

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch(backendUrl("/api/versions/"), {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string; server?: string }>;
}) {
  const { game_version: gameVersion, server = "PBE" } = await searchParams;

  const [units, versions] = await Promise.all([fetchUnits(server), fetchVersions()]);

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
