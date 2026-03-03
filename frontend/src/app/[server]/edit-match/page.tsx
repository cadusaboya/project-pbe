import MatchEditor from "../../components/MatchEditor";
import { fetchJson } from "@/lib/api";

interface ChampionInfo {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

interface ItemAssetsResponse {
  assets: Record<string, string>;
  names: Record<string, string>;
}

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ server: string }>;
}) {
  const { server: serverSlug } = await params;
  const server = serverSlug.toUpperCase();

  const [champions, itemData] = await Promise.all([
    fetchJson<ChampionInfo[]>(`/api/champions/?server=${server}`).catch(
      () => [] as ChampionInfo[],
    ),
    fetchJson<ItemAssetsResponse>("/api/item-assets/").catch(() => ({
      assets: {} as Record<string, string>,
      names: {} as Record<string, string>,
    })),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-tft-text">
          Edit Match
        </h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Search for a player to find their matches, then edit units, items, and
          match time.
        </p>
      </div>
      <MatchEditor
        champions={champions}
        itemAssets={itemData.assets}
        itemNames={itemData.names}
        server={server}
      />
    </div>
  );
}
