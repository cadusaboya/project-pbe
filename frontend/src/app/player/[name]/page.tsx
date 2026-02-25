import PlayerProfile, { PlayerProfileData, TraitInfo } from "../../components/PlayerProfile";
import { getDataVersion, fetchApi } from "@/lib/api";
import Link from "next/link";

async function fetchPlayerProfile(dv: number, name: string): Promise<PlayerProfileData> {
  const res = await fetchApi(`/api/player/${encodeURIComponent(name)}/profile/`, { revalidate: 60 }, dv);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Player not found");
    throw new Error(`Failed to fetch profile: ${res.status}`);
  }
  return res.json();
}

async function fetchItemData(dv: number): Promise<{ assets: Record<string, string>; names: Record<string, string> }> {
  try {
    const res = await fetchApi("/api/item-assets/", { revalidate: 60 }, dv);
    if (!res.ok) return { assets: {}, names: {} };
    return res.json();
  } catch {
    return { assets: {}, names: {} };
  }
}

async function fetchTraitBreakpoints(dv: number): Promise<Record<string, TraitInfo>> {
  try {
    const res = await fetchApi("/api/traits/", { revalidate: 60 }, dv);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const dv = await getDataVersion();

  let profile: PlayerProfileData | null = null;
  let itemAssets: Record<string, string> = {};
  let itemNames: Record<string, string> = {};
  let traitData: Record<string, TraitInfo> = {};
  let error: string | null = null;

  try {
    let itemData: { assets: Record<string, string>; names: Record<string, string> };
    [profile, itemData, traitData] = await Promise.all([
      fetchPlayerProfile(dv, decodedName),
      fetchItemData(dv),
      fetchTraitBreakpoints(dv),
    ]);
    itemAssets = itemData.assets;
    itemNames = itemData.names;
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/games-feed"
        className="inline-flex items-center gap-1.5 text-tft-muted hover:text-tft-gold text-sm transition-colors"
      >
        <span>←</span>
        <span>Back to Games Feed</span>
      </Link>

      {error ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-8 text-center">
          <p className="text-red-400 text-lg font-semibold">{error}</p>
          <p className="text-red-500/70 text-sm mt-2">
            Player &quot;{decodedName}&quot; was not found in the tracked player list.
          </p>
        </div>
      ) : profile ? (
        <PlayerProfile data={profile} itemAssets={itemAssets} itemNames={itemNames} traitData={traitData} />
      ) : null}
    </div>
  );
}
