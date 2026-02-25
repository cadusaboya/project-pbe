import { Suspense } from "react";
import { getDataVersion, fetchApi } from "@/lib/api";
import ItemsExplorer from "../components/ItemsExplorer";
import { UnitStat } from "../components/StatsTable";

async function fetchUnits(dv: number): Promise<UnitStat[]> {
  try {
    const res = await fetchApi("/api/unit-stats/?sort=games", { revalidate: 60 }, dv);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchVersions(dv: number): Promise<string[]> {
  try {
    const res = await fetchApi("/api/versions/", { revalidate: 60 }, dv);
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
  const dv = await getDataVersion();

  const [units, versions] = await Promise.all([fetchUnits(dv), fetchVersions(dv)]);

  return (
    <Suspense fallback={null}>
      <ItemsExplorer
        units={units}
        versions={versions}
        selectedVersion={gameVersion ?? ""}
        dataVersion={dv}
      />
    </Suspense>
  );
}
