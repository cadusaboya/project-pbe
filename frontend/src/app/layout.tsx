import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import StatsBar from "./components/StatsBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "TFT PBE Tracker",
  description: "Unit statistics tracker for TFT PBE matches",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tft-bg text-tft-text antialiased">
        <header className="border-b border-tft-border bg-tft-surface/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-tft-gold text-2xl font-bold tracking-tight">
                Project PBE Tracker
              </span>
            </div>
            <nav className="flex items-center gap-1">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md text-sm font-medium text-tft-muted hover:text-tft-text hover:bg-tft-hover transition-colors"
              >
                Unit Stats
              </Link>
              <Link
                href="/items"
                className="px-3 py-1.5 rounded-md text-sm font-medium text-tft-muted hover:text-tft-text hover:bg-tft-hover transition-colors"
              >
                Items
              </Link>
              <Link
                href="/explore"
                className="px-3 py-1.5 rounded-md text-sm font-medium text-tft-muted hover:text-tft-text hover:bg-tft-hover transition-colors"
              >
                Data Explorer
              </Link>
              <Link
                href="/last-games"
                className="px-3 py-1.5 rounded-md text-sm font-medium text-tft-muted hover:text-tft-text hover:bg-tft-hover transition-colors"
              >
                Games
              </Link>
            </nav>
          </div>
        </header>
        <Suspense fallback={null}>
          <StatsBar />
        </Suspense>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
