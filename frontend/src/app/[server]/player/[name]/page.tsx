import { Suspense } from "react";
import PlayerProfile, { PlayerProfileData, TraitInfo } from "../../../components/PlayerProfile";
import PageSkeleton from "../../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";
import { DEFAULT_PBE_TIER, DEFAULT_PBE_QUEUE } from "@/lib/constants";
import Link from "next/link";

async function fetchPlayerProfile(name: string, server?: string, tier?: string, queue?: string): Promise<PlayerProfileData> {
  const params = new URLSearchParams();
  if (server) params.set("server", server);
  if (tier) params.set("tier", tier);
  if (queue) params.set("queue", queue);
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
  tier,
  queue,
}: {
  decodedName: string;
  server: string;
  tier?: string;
  queue?: string;
}) {
  let profile: PlayerProfileData | null = null;
  let itemAssets: Record<string, string> = {};
  let itemNames: Record<string, string> = {};
  let traitData: Record<string, TraitInfo> = {};
  let error: string | null = null;

  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [profile, itemData, traitData] = await Promise.all([
      fetchPlayerProfile(decodedName, server, tier, queue),
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
  searchParams,
}: {
  params: Promise<{ server: string; name: string }>;
  searchParams: Promise<{ game_version?: string; tier?: string; queue?: string }>;
}) {
  const { server: serverSlug, name } = await params;
  const server = serverSlug.toUpperCase();
  const { tier: rawTier, queue: rawQueue } = await searchParams;
  const isPbe = server === "PBE";
  const tier = rawTier ?? (isPbe ? DEFAULT_PBE_TIER : undefined);
  const queue = rawQueue ?? (isPbe ? DEFAULT_PBE_QUEUE : undefined);
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
        <ProfileContent decodedName={decodedName} server={server} tier={tier} queue={queue} />
      </Suspense>
    </div>
  );
}
