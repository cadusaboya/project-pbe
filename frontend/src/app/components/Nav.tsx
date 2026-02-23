"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/comps", label: "Comps" },
  { href: "/unit-stats", label: "Stats" },
  { href: "/items", label: "Items" },
  { href: "/search", label: "Unit History" },
  { href: "/games-feed", label: "Games Feed" },
  { href: "/players", label: "Player Stats" },
  { href: "/explore", label: "Data Explorer" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-tft-gold/15 text-tft-gold border border-tft-gold/30"
                : "text-tft-muted hover:text-tft-text hover:bg-tft-hover border border-transparent"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
