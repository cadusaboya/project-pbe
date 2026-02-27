import { Suspense } from "react";
import TeamBuilder from "../../components/TeamBuilder";
import PageSkeleton from "../../components/PageSkeleton";
import { fetchJson } from "@/lib/api";

interface Champion {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
}

type TraitData = Record<string, { breakpoints: number[]; icon: string }>;

async function fetchChampions(): Promise<Champion[]> {
  try {
    return await fetchJson<Champion[]>("/api/champions/");
  } catch {
    return [];
  }
}

async function fetchTraits(): Promise<TraitData> {
  try {
    return await fetchJson<TraitData>("/api/traits/");
  } catch {
    return {};
  }
}

async function TeamBuilderContent() {
  const [champions, traitData] = await Promise.all([
    fetchChampions(),
    fetchTraits(),
  ]);

  if (champions.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-surface/40 px-5 py-12 text-center text-tft-muted text-sm">
        Could not load champion data. Make sure the backend is running.
      </div>
    );
  }

  return <TeamBuilder champions={champions} traitData={traitData} />;
}

export default async function TeamBuilderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Team Builder</h1>
        <p className="text-tft-muted text-sm mt-1">
          Theorycraft TFT Set 16 compositions. Click a champion, then click a
          hex to place it on the board.
        </p>
      </div>

      <Suspense fallback={<PageSkeleton variant="explorer" />}>
        <TeamBuilderContent />
      </Suspense>
    </div>
  );
}
