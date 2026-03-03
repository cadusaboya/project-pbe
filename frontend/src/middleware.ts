import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const VALID_SERVERS = new Set(["pbe", "live", "scrims"]);

const PAGE_SLUGS = new Set([
  "comps",
  "unit-stats",
  "items",
  "search",
  "games-feed",
  "players",
  "player",
  "explore",
  "last-games",
  "teambuilder",
  "upload",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return;

  const first = segments[0].toLowerCase();

  // Already has a valid server prefix — let it through
  if (VALID_SERVERS.has(first)) {
    // Redirect /{server}/search → /{server}/games-feed
    if (segments.length >= 2 && segments[1].toLowerCase() === "search") {
      const url = request.nextUrl.clone();
      url.pathname = `/${first}/games-feed`;
      return NextResponse.redirect(url, 308);
    }
    return;
  }

  // Redirect bare /search → /pbe/games-feed
  if (first === "search") {
    const url = request.nextUrl.clone();
    url.pathname = `/pbe/games-feed`;
    return NextResponse.redirect(url, 308);
  }

  // If the first segment is a known page slug, redirect to /pbe/<path>
  if (PAGE_SLUGS.has(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/pbe${pathname}`;
    return NextResponse.redirect(url, 308);
  }
}

export const config = {
  matcher: [
    // Match everything except _next, api, static files
    "/((?!_next|api|favicon\\.png|logo\\.png|og-image\\.png|.*\\.).*)",
  ],
};
