import { Suspense } from "react";
import CompsList, { CompStat } from "../../../components/CompsList";
import VersionFilter from "../../../components/VersionFilter";
import PageSkeleton from "../../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";
import { DEFAULT_GAME_VERSION } from "@/lib/constants";

async function fetchHiddenCompStats(
  gameVersion?: string,
  coreSizes?: string,
  minOccurrences?: string,
  server?: string,
): Promise<CompStat[]> {
  const params = new URLSearchParams({ limit: "20" });
  if (gameVersion) params.set("game_version", gameVersion);
  if (coreSizes) params.set("core_sizes", coreSizes);
  if (minOccurrences) params.set("min_occurrences", minOccurrences);
  if (server) params.set("server", server);
  return fetchJson<CompStat[]>(`/api/comps/hidden/?${params}`);
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

async function fetchTraits(server?: string): Promise<Record<string, { breakpoints: number[]; icon: string }>> {
  try {
    const params = new URLSearchParams();
    if (server) params.set("server", server);
    const qs = params.toString();
    return await fetchJson<Record<string, { breakpoints: number[]; icon: string }>>(`/api/traits/${qs ? `?${qs}` : ""}`);
  } catch {
    return {};
  }
}

async function HiddenCompsContent({
  server,
  serverSlug,
  gameVersion,
  coreSizes,
  minOccurrences,
}: {
  server: string;
  serverSlug: string;
  gameVersion: string;
  coreSizes: string;
  minOccurrences: string;
}) {
  let data: CompStat[] = [];
  let versions: string[] = [];
  let traitData: Record<string, { breakpoints: number[]; icon: string }> = {};
  let error: string | null = null;

  try {
    [data, versions, traitData] = await Promise.all([
      fetchHiddenCompStats(gameVersion, coreSizes, minOccurrences, server),
      fetchVersions(server),
      fetchTraits(server),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <VersionFilter versions={versions} selectedVersion={gameVersion} />
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
          selectedVersion={gameVersion}
          basePath={`/${serverSlug}/comps/hidden`}
          showHiddenFilters
          selectedCoreSizes={coreSizes}
          selectedMinOccurrences={minOccurrences}
          traitData={traitData}
          server={server}
        />
      )}
    </div>
  );
}

export default async function HiddenCompsPage({
  params,
  searchParams,
}: {
  params: Promise<{ server: string }>;
  searchParams: Promise<{ game_version?: string; core_sizes?: string; min_occurrences?: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();
  const {
    game_version: gameVersion,
    core_sizes: coreSizes = "4,5,6",
    min_occurrences: minOccurrences = "100",
  } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">Hidden Compositions</h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Auto-discovered comps from match data. Use this page as reference to create curated comps.
        </p>
      </div>

      <Suspense fallback={<PageSkeleton variant="cards" />}>
        <HiddenCompsContent
          server={server}
          serverSlug={serverSlug}
          gameVersion={gameVersion ?? DEFAULT_GAME_VERSION}
          coreSizes={coreSizes}
          minOccurrences={minOccurrences}
        />
      </Suspense>
    </div>
  );
}
