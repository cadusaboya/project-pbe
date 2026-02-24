import { Suspense } from "react";
import { backendUrl } from "@/lib/backend";
import ItemsExplorer from "../components/ItemsExplorer";
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

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string }>;
}) {
  const { game_version: gameVersion } = await searchParams;

  const [units, versions] = await Promise.all([fetchUnits(), fetchVersions()]);

  return (
    <Suspense fallback={null}>
      <ItemsExplorer
        units={units}
        versions={versions}
        selectedVersion={gameVersion ?? ""}
      />
    </Suspense>
  );
}
