import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getDataVersion } from "@/lib/api";
import StatsBar from "./components/StatsBar";
import FreshnessGuard from "./components/FreshnessGuard";
import Nav from "./components/Nav";
import ServerSelector from "./components/ServerSelector";
import "./globals.css";

export const metadata: Metadata = {
  title: "TFT Pro Radar — Real-Time PBE Meta Tracker",
  description:
    "Track every TFT Project PBE lobby in real time. Unit stats, top comps, item analytics, player rankings, and a live game feed — know the meta before everyone else.",
  icons: {
    icon: "/favicon.png",
  },
  metadataBase: new URL("https://tftproradar.com"),
  openGraph: {
    title: "TFT Pro Radar — Real-Time PBE Meta Tracker",
    description:
      "Live unit stats, top comps, item analytics, and player rankings from every TFT PBE lobby. Get the edge before the patch hits live.",
    siteName: "TFT Pro Radar",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TFT Pro Radar — Know the meta before everyone else",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TFT Pro Radar — Real-Time PBE Meta Tracker",
    description:
      "Live unit stats, top comps, item analytics, and player rankings from every TFT PBE lobby.",
    images: ["/og-image.png"],
    creator: "@TFTProRadar",
  },
  keywords: [
    "TFT",
    "Teamfight Tactics",
    "PBE",
    "meta",
    "tier list",
    "unit stats",
    "comps",
    "items",
    "pro players",
    "tracker",
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const dv = await getDataVersion();

  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://raw.communitydragon.org" />
        <link rel="preconnect" href="https://raw.communitydragon.org" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-tft-bg text-tft-text antialiased">
        <header className="border-b border-tft-border bg-gradient-to-b from-tft-surface to-tft-bg/95 backdrop-blur-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3 space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/" className="flex items-center gap-2 shrink-0">
                <Image
                  src="/logo.png"
                  alt="TFT Pro Radar"
                  width={40}
                  height={40}
                  className="rounded-md w-8 h-8 sm:w-10 sm:h-10"
                />
                <span className="text-tft-gold text-lg sm:text-2xl font-bold tracking-tight">
                  TFT Pro Radar
                </span>
              </Link>
              <Suspense fallback={null}>
                <ServerSelector />
              </Suspense>
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <a
                  href="https://x.com/TFTProRadar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium border border-tft-border text-tft-text/70 hover:text-tft-text hover:bg-tft-hover transition-colors inline-flex items-center gap-1.5"
                  title="Follow us on X"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-current"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <span className="hidden sm:inline">Stay Updated</span>
                </a>
                <a
                  href="https://discord.gg/6TuFHT7ZJF"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium border border-tft-border text-tft-text/70 hover:text-tft-text hover:bg-tft-hover transition-colors inline-flex items-center gap-1.5"
                  title="Join our Discord server"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-current"
                  >
                    <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.212.375-.447.864-.613 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.621-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.1 14.1 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.08 13.08 0 0 1-1.872-.892.077.077 0 0 1-.008-.127c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.36 1.225 1.993a.077.077 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.947 2.419-2.157 2.419Z" />
                  </svg>
                  <span className="hidden sm:inline">Join Discord</span>
                </a>
              </div>
            </div>
            <Suspense fallback={null}>
              <Nav />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <StatsBar />
          </Suspense>
        </header>
        <FreshnessGuard dataVersion={dv} />
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">{children}</main>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
