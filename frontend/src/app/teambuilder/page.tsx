import TeamBuilder from "../components/TeamBuilder";
import { getDataVersion, fetchApi } from "@/lib/api";

interface Champion {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

async function fetchChampions(dv: number): Promise<Champion[]> {
  try {
    const res = await fetchApi("/api/champions/", { revalidate: 60 }, dv);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchTraits(dv: number): Promise<TraitData> {
  try {
    const res = await fetchApi("/api/traits/", { revalidate: 60 }, dv);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function TeamBuilderPage() {
  const dv = await getDataVersion();
  const [champions, traitData] = await Promise.all([
    fetchChampions(dv),
    fetchTraits(dv),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Team Builder</h1>
        <p className="text-tft-muted text-sm mt-1">
          Theorycraft TFT Set 16 compositions. Click a champion, then click a
          hex to place it on the board.
        </p>
      </div>

      {champions.length === 0 ? (
        <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
          Could not load champion data. Make sure the backend is running.
        </div>
      ) : (
        <TeamBuilder champions={champions} traitData={traitData} />
      )}
    </div>
  );
}
