import TeamBuilder from "../components/TeamBuilder";
import { backendUrl } from "@/lib/backend";

interface Champion {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

async function fetchChampions(): Promise<Champion[]> {
  try {
    const res = await fetch(backendUrl("/api/champions/"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchTraits(): Promise<TraitData> {
  try {
    const res = await fetch(backendUrl("/api/traits/"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export default async function TeamBuilderPage() {
  const [champions, traitData] = await Promise.all([
    fetchChampions(),
    fetchTraits(),
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
