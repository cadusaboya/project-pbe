import ScrimUpload from "../../components/ScrimUpload";
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

export default async function UploadPage({
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
          Upload Scrim
        </h1>
        <p className="text-tft-muted text-xs sm:text-sm mt-1">
          Upload a TFT lobby screenshot to record a scrim match.
        </p>
      </div>
      <ScrimUpload
        champions={champions}
        itemAssets={itemData.assets}
        itemNames={itemData.names}
        server={server}
      />
    </div>
  );
}
