import { Suspense } from "react";
import { backendUrl } from "@/lib/backend";
import DataExplorer from "../components/DataExplorer";
import { UnitStat } from "../components/StatsTable";

async function fetchUnits(): Promise<UnitStat[]> {
  try {
    const res = await fetch(backendUrl("/api/unit-stats/?sort=games"), {
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

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;

  const [units, versions] = await Promise.all([fetchUnits(), fetchVersions()]);

  return (
    <Suspense fallback={null}>
      <DataExplorer
        units={units}
        versions={versions}
        selectedVersion={gameVersion ?? ""}
      />
    </Suspense>
  );
}
