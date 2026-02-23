import LiveMatchesList, { LiveGame } from "../components/LiveMatchesList";
import { backendUrl } from "@/lib/backend";

async function fetchLiveMatches(): Promise<LiveGame[]> {
  try {
    const res = await fetch(backendUrl("/api/live-matches/"), {
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function LivePage() {
  const games = await fetchLiveMatches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-tft-text">Live Matches</h1>
        <p className="text-tft-muted text-sm mt-1">
          Currently active games with tracked pro players. Updated every few
          minutes.
        </p>
      </div>
      <LiveMatchesList initialData={games} />
    </div>
  );
}
