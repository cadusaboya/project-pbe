import CompsList, { CompStat } from "../../components/CompsList";
import { backendUrl } from "@/lib/backend";

async function fetchHiddenCompStats(
  gameVersion?: string,
  coreSizes?: string,
  minOccurrences?: string,
): Promise<CompStat[]> {
  const url = new URL(backendUrl("/api/comps/hidden/"));
  url.searchParams.set("limit", "20");
  if (gameVersion) url.searchParams.set("game_version", gameVersion);
  if (coreSizes) url.searchParams.set("core_sizes", coreSizes);
  if (minOccurrences) url.searchParams.set("min_occurrences", minOccurrences);

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch hidden composition stats: ${res.status}`);
  }
  return res.json();
}

async function fetchVersions(): Promise<string[]> {
  try {
    const res = await fetch(backendUrl("/api/versions/"), { next: { revalidate: 60 } });
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

export default async function HiddenCompsPage({
  searchParams,
}: {
  searchParams: Promise<{ game_version?: string; core_sizes?: string; min_occurrences?: string }>;
}) {
  const {
    game_version: gameVersion,
    core_sizes: coreSizes = "4,5,6",
    min_occurrences: minOccurrences = "100",
  } = await searchParams;
  let data: CompStat[] = [];
  let versions: string[] = [];
  let traitData: Record<string, { breakpoints: number[]; icon: string }> = {};
  let error: string | null = null;

  try {
    [data, versions, traitData] = await Promise.all([
      fetchHiddenCompStats(gameVersion, coreSizes, minOccurrences),
      fetchVersions(),
      fetchTraits(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Hidden Compositions</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Auto-discovered comps from match data. Use this page as reference to create curated comps.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
          <p className="mt-1 text-red-500/70">
            Make sure the backend is running and reachable.
          </p>
        </div>
      ) : (
        <CompsList
          data={data}
          versions={versions}
          selectedVersion={gameVersion ?? ""}
          basePath="/comps/hidden"
          showHiddenFilters
          selectedCoreSizes={coreSizes}
          selectedMinOccurrences={minOccurrences}
          traitData={traitData}
        />
      )}
    </div>
  );
}
