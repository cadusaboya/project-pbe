import { Suspense } from "react";
import PlayerProfile, { PlayerProfileData, TraitInfo } from "../../../components/PlayerProfile";
import PageSkeleton from "../../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";
import Link from "next/link";

async function fetchPlayerProfile(name: string, server?: string): Promise<PlayerProfileData> {
  const params = new URLSearchParams();
  if (server) params.set("server", server);
  const qs = params.toString();
  return fetchJson<PlayerProfileData>(`/api/player/${encodeURIComponent(name)}/profile/${qs ? `?${qs}` : ""}`);
}

async function fetchItemData(): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    return await fetchJson<{ assets: Record<string, string>; names: Record<string, string> }>("/api/item-assets/");
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchTraitBreakpoints(): Promise<Record<string, TraitInfo>> {
  try {
    return await fetchJson<Record<string, TraitInfo>>("/api/traits/");
  } catch {
    return {};
  }
}

async function ProfileContent({
  decodedName,
  server,
}: {
  decodedName: string;
  server: string;
}) {
  let profile: PlayerProfileData | null = null;
  let itemAssets: Record<string, string> = {};
  let itemNames: Record<string, string> = {};
  let traitData: Record<string, TraitInfo> = {};
  let error: string | null = null;

  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [profile, itemData, traitData] = await Promise.all([
      fetchPlayerProfile(decodedName, server),
      fetchItemData(),
      fetchTraitBreakpoints(),
    ]);
    itemAssets = itemData.assets;
    itemNames = itemData.names;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-8 text-center">
        <p className="text-red-400 text-lg font-semibold">{error}</p>
        <p className="text-red-500/70 text-sm mt-2">
          Player &quot;{decodedName}&quot; was not found in the tracked player list.
        </p>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <PlayerProfile data={profile} itemAssets={itemAssets} itemNames={itemNames} traitData={traitData} server={server} />
  );
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ server: string; name: string }>;
}) {
  const { server: serverSlug, name } = await params;
  const server = serverSlug.toUpperCase();
  const decodedName = decodeURIComponent(name);

  return (
    <div className="space-y-6">
      <Link
        href={`/${serverSlug}/games-feed`}
        className="inline-flex items-center gap-1.5 text-tft-muted hover:text-tft-gold text-sm transition-colors"
      >
        <span>&larr;</span>
        <span>Back to Games Feed</span>
      </Link>

      <Suspense fallback={<PageSkeleton variant="profile" />}>
        <ProfileContent decodedName={decodedName} server={server} />
      </Suspense>
    </div>
  );
}
