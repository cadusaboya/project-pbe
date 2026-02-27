import { Suspense } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/api";
import PageSkeleton from "./components/PageSkeleton";

interface TopUnit {
  unit_name: string;
  cost: number;
  games: number;
  avg_placement: number;
}

interface FlexCombo {
  units: { character_id: string; cost: number }[];
  comps: number;
  avg_placement: number;
}

interface TopComp {
  name: string;
  core_units: { character_id: string; cost: number }[];
  avg_placement: number;
  comps: number;
  top4_rate: number;
  win_rate: number;
  flex_combos: FlexCombo[];
}

async function fetchTopUnits(server?: string): Promise<TopUnit[]> {
  try {
    const params = new URLSearchParams({ sort: "avg_placement", min_games: "20" });
    if (server) params.set("server", server);
    const data = await fetchJson<TopUnit[]>(`/api/unit-stats/?${params}`);
    return data.slice(0, 5);
  } catch {
    return [];
  }
}

async function fetchTopComps(server?: string): Promise<TopComp[]> {
  try {
    const params = new URLSearchParams({ top_flex: "1" });
    if (server) params.set("server", server);
    const json = await fetchJson<{ comps?: TopComp[] } | TopComp[]>(`/api/comps/?${params}`);
    const data: TopComp[] = Array.isArray(json) ? json : json.comps ?? [];
    return data.filter((c) => c.comps > 0).sort((a, b) => a.avg_placement - b.avg_placement).slice(0, 5);
  } catch {
    return [];
  }
}

const COST_COLORS: Record<number, string> = {
  1: "border-gray-500",
  2: "border-green-600",
  3: "border-blue-500",
  4: "border-purple-500",
  5: "border-yellow-400",
  7: "border-yellow-400",
};

function unitImageUrl(characterId: string): string {
  const lower = characterId.toLowerCase();
  const setNum = lower.match(/^tft(\d+)_/)?.[1] ?? "16";
  return `https://raw.communitydragon.org/pbe/game/assets/characters/${lower}/hud/${lower}_square.tft_set${setNum}.png`;
}

function formatUnit(name: string): string {
  return name.replace(/^TFT\d+_/, "");
}

function avpColor(avp: number): string {
  if (avp <= 3.5) return "text-emerald-400";
  if (avp <= 4.0) return "text-teal-400";
  if (avp <= 4.5) return "text-amber-300";
  return "text-rose-400";
}

function compTier(avp: number): { label: string; color: string; bg: string } {
  if (avp < 3.7) return { label: "S", color: "text-red-400", bg: "bg-red-500/20 border border-red-500/40" };
  if (avp < 4.0) return { label: "A", color: "text-orange-400", bg: "bg-orange-500/20 border border-orange-500/40" };
  if (avp < 4.4) return { label: "B", color: "text-yellow-400", bg: "bg-yellow-500/20 border border-yellow-500/40" };
  if (avp < 4.8) return { label: "C", color: "text-lime-400", bg: "bg-lime-500/20 border border-lime-500/40" };
  return { label: "D", color: "text-slate-400", bg: "bg-slate-500/15 border border-slate-500/30" };
}

function IconGrid() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function IconSword() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconFeed() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-tft-gold">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.77.853m0 0a6.023 6.023 0 0 1-2.77-.853" />
    </svg>
  );
}

const features = [
  {
    icon: <IconGrid />,
    title: "Comp Tracker",
    desc: "See exactly what top players are running: boards, units, items, and star levels from real games.",
    href: "/pbe/comps",
  },
  {
    icon: <IconChart />,
    title: "Unit Stats",
    desc: "AVP, top 4 rate, and win rate for every unit. Find what's broken before everyone else does.",
    href: "/pbe/unit-stats",
  },
  {
    icon: <IconSword />,
    title: "Item Explorer",
    desc: "Which items are winning on which champions? Data-driven itemization insights.",
    href: "/pbe/items",
  },
  {
    icon: <IconSearch />,
    title: "Unit Search",
    desc: "Search any champion and instantly see every comp it appears in with full stats.",
    href: "/pbe/search",
  },
  {
    icon: <IconFeed />,
    title: "Games Feed",
    desc: "Live feed of the latest lobbies. Watch the meta shift in real time.",
    href: "/pbe/games-feed",
  },
  {
    icon: <IconTrophy />,
    title: "Player Stats",
    desc: "Player rankings, most played units, and performance breakdowns.",
    href: "/pbe/players",
  },
];

async function QuickStatsContent({ server }: { server: string }) {
  const [topUnits, topComps] = await Promise.all([fetchTopUnits(server), fetchTopComps(server)]);
  const hasQuickStats = topUnits.length > 0 || topComps.length > 0;

  if (!hasQuickStats) return null;

  return (
    <section className="space-y-6 -mt-12">
      <div className="grid md:grid-cols-2 gap-6">
        {topUnits.length > 0 && (
          <Link href="/pbe/unit-stats" className="group rounded-xl border border-tft-border bg-tft-surface/40 p-5 hover:border-tft-gold/30 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-tft-muted uppercase tracking-wider">Top Units by AVP</h3>
              <span className="text-xs text-tft-muted group-hover:text-tft-gold transition-colors">View all →</span>
            </div>
            <div className="space-y-2.5">
              {topUnits.map((unit, i) => (
                <div key={unit.unit_name} className="flex items-center gap-3">
                  <span className="text-sm font-bold text-tft-muted/50 w-5 tabular-nums">{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={unitImageUrl(unit.unit_name)}
                    alt={formatUnit(unit.unit_name)}
                    width={36}
                    height={36}
                    className={`w-9 h-9 rounded-lg border-2 ${COST_COLORS[unit.cost] ?? "border-gray-500"} object-cover`}
                  />
                  <span className="text-sm font-medium text-tft-text flex-1">{formatUnit(unit.unit_name)}</span>
                  <span className={`text-sm font-semibold tabular-nums ${avpColor(unit.avg_placement)}`}>
                    {unit.avg_placement.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </Link>
        )}

        {topComps.length > 0 && (
          <Link href="/pbe/comps" className="group rounded-xl border border-tft-border bg-tft-surface/40 p-5 hover:border-tft-gold/30 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-tft-muted uppercase tracking-wider">Top Comps</h3>
              <span className="text-xs text-tft-muted group-hover:text-tft-gold transition-colors">View all →</span>
            </div>
            <div className="space-y-2.5">
              {topComps.map((comp, i) => {
                const tier = compTier(comp.avg_placement);
                const bestFlex = comp.flex_combos?.[0];
                return (
                  <div key={i} className="flex items-center gap-2 h-9">
                    <span className="text-sm font-bold text-tft-muted/50 w-5 tabular-nums">{i + 1}</span>
                    <span className={`text-xs font-bold w-5 h-5 flex items-center justify-center rounded ${tier.bg} ${tier.color}`}>
                      {tier.label}
                    </span>
                    <div className="flex items-center gap-1 flex-1">
                      {[...comp.core_units, ...(bestFlex?.units ?? [])].map((u) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={u.character_id}
                          src={unitImageUrl(u.character_id)}
                          alt={formatUnit(u.character_id)}
                          width={28}
                          height={28}
                          className={`w-7 h-7 rounded border-2 ${COST_COLORS[u.cost] ?? "border-gray-500"} object-cover`}
                        />
                      ))}
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${avpColor(comp.avg_placement)}`}>
                      {comp.avg_placement.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const { server = "PBE" } = await searchParams;

  return (
    <div className="space-y-12 sm:space-y-24 pb-8 sm:pb-16">
      {/* Hero */}
      <section className="relative text-center pt-8 sm:pt-12 md:pt-20 pb-4">
        {/* Glow effect */}
        <div className="absolute inset-0 -top-20 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-tft-gold/5 blur-[120px]" />
        </div>

        <div className="relative space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-tft-gold/30 bg-tft-gold/5 text-tft-gold text-sm font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tft-gold opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-tft-gold" />
            </span>
            Tracking the best players worldwide
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight">
            <span className="text-tft-text">Know the meta</span>
            <br />
            <span className="bg-gradient-to-r from-tft-gold via-yellow-300 to-tft-accent bg-clip-text text-transparent">
              before everyone else.
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base sm:text-lg md:text-xl text-tft-muted leading-relaxed">
            We track the best players around the globe.
            Everything analyzed and served in real time so you can learn from the best competitive TFT players in the world.
          </p>

          <div className="flex flex-wrap justify-center gap-3 sm:gap-4 pt-4">
            <Link
              href="/pbe/games-feed"
              className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-lg bg-gradient-to-r from-tft-gold to-yellow-500 text-tft-bg font-bold text-base sm:text-lg hover:brightness-110 transition-all shadow-lg shadow-tft-gold/20"
            >
              Explore Project PBE Games
            </Link>
            <Link
              href="/pbe/comps"
              className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-lg border border-tft-border bg-tft-surface/80 text-tft-text font-semibold text-base sm:text-lg hover:border-tft-gold/50 hover:bg-tft-hover transition-colors"
            >
              View Top Comps
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Stats — top units & comps at a glance */}
      <Suspense fallback={<PageSkeleton variant="landing" />}>
        <QuickStatsContent server={server} />
      </Suspense>

      {/* How it works */}
      <section className="space-y-6 sm:space-y-10">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center">
          How it <span className="text-tft-gold">works</span>
        </h2>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          {[
            {
              step: "01",
              title: "We watch the best",
              desc: "Our system tracks pros, streamers, and top players across all major regions. Every ranked game from the best TFT players in the world.",
            },
            {
              step: "02",
              title: "Every game analyzed",
              desc: "Each match is broken down into comps, items, and placements. Nothing gets missed.",
            },
            {
              step: "03",
              title: "You get the edge",
              desc: "Browse aggregated stats, trending comps, and real-time game feeds. Know what's strong before your opponents.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="relative rounded-xl border border-tft-border bg-tft-surface/40 p-6 space-y-3 hover:border-tft-gold/30 transition-colors"
            >
              <span className="text-5xl font-black text-tft-gold/10">{s.step}</span>
              <h3 className="text-xl font-bold text-tft-text">{s.title}</h3>
              <p className="text-tft-muted leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section className="space-y-6 sm:space-y-10">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center">
          Everything you <span className="text-tft-gold">need</span>
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {features.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="group rounded-xl border border-tft-border bg-tft-surface/40 p-4 sm:p-6 space-y-2 sm:space-y-3 hover:border-tft-gold/40 hover:bg-tft-hover/50 transition-all"
            >
              {f.icon}
              <h3 className="text-sm sm:text-lg font-bold text-tft-text group-hover:text-tft-gold transition-colors">
                {f.title}
              </h3>
              <p className="text-xs sm:text-sm text-tft-muted leading-relaxed">{f.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Now Live — Live Server */}
      <section className="relative rounded-2xl border border-tft-gold/20 bg-gradient-to-br from-tft-surface via-tft-bg to-tft-surface overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-tft-gold/5 blur-[80px]" />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full bg-tft-gold/5 blur-[80px]" />
        </div>

        <div className="relative p-5 sm:p-8 md:p-12 space-y-4 sm:space-y-6 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-sm font-semibold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Now Live
          </span>

          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold">
            <span className="text-tft-text">Tracking the </span>
            <span className="bg-gradient-to-r from-tft-gold to-yellow-300 bg-clip-text text-transparent">
              Live Server
            </span>
          </h2>

          <p className="max-w-2xl mx-auto text-tft-muted text-sm sm:text-lg leading-relaxed">
            TFT Pro Radar is now tracking
            <span className="text-tft-text font-semibold"> how the best players play</span> on
            the live server with full depth and speed, covering every ranked game
            from pro player lobbies across all regions.
          </p>

          <div className="grid sm:grid-cols-3 gap-6 pt-4 max-w-3xl mx-auto">
            {[
              { value: "All Regions", label: "NA, EUW, KR, and more" },
              { value: "Pro Players", label: "Tracking only the best" },
              { value: "Real Time", label: "Games tracked as they finish" },
            ].map((stat) => (
              <div key={stat.label} className="space-y-1">
                <p className="text-2xl font-bold text-tft-gold">{stat.value}</p>
                <p className="text-sm text-tft-muted">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <Link
              href="/live/games-feed"
              className="inline-flex px-6 sm:px-8 py-2.5 sm:py-3 rounded-lg bg-gradient-to-r from-tft-gold to-yellow-500 text-tft-bg font-bold text-base sm:text-lg hover:brightness-110 transition-all shadow-lg shadow-tft-gold/20"
            >
              Track Live Games Now
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center space-y-4 sm:space-y-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-tft-text">
          Stop guessing. Start climbing.
        </h2>
        <p className="text-tft-muted text-sm sm:text-lg max-w-xl mx-auto">
          Join hundreds of players already using TFT Pro Radar to stay ahead of the meta.
        </p>
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
          <Link
            href="/pbe/games-feed"
            className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-lg bg-gradient-to-r from-tft-gold to-yellow-500 text-tft-bg font-bold text-base sm:text-lg hover:brightness-110 transition-all shadow-lg shadow-tft-gold/20"
          >
            Get Started
          </Link>
          <a
            href="https://discord.gg/6TuFHT7ZJF"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-lg border border-tft-border bg-tft-surface/80 text-tft-text font-semibold text-base sm:text-lg hover:border-tft-gold/50 hover:bg-tft-hover transition-colors"
          >
            Join the Discord
          </a>
        </div>
      </section>
    </div>
  );
}
