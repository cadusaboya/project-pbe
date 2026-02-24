"use client";

import { useState } from "react";
import {
  unitImageUrl,
  itemImageUrl,
  formatUnit,
  costBorderColor,
  COST_HEX_COLORS,
} from "@/lib/tftUtils";

// ── UnitImage ────────────────────────────────────────────────────────────────

interface UnitImageProps {
  characterId: string;
  cost: number;
  size?: number;
  className?: string;
  borderWidth?: 1 | 2;
}

export function UnitImage({
  characterId,
  cost,
  size = 44,
  className = "",
  borderWidth = 2,
}: UnitImageProps) {
  const [failed, setFailed] = useState(false);
  const border = `border${borderWidth === 1 ? "" : "-2"} ${costBorderColor(cost)}`;
  const displayName = formatUnit(characterId);
  const letter = displayName.charAt(0).toUpperCase();
  const bgColor = COST_HEX_COLORS[cost] ?? "#6b7280";

  if (failed) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center shrink-0 ${border} ${className}`}
        style={{ width: size, height: size, backgroundColor: `${bgColor}33` }}
        title={displayName}
      >
        <span
          className="font-bold text-white/80 select-none"
          style={{ fontSize: Math.max(10, size * 0.4) }}
        >
          {letter}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={unitImageUrl(characterId)}
      alt={displayName}
      width={size}
      height={size}
      className={`object-cover rounded-lg shrink-0 ${border} ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

// ── ItemImage ────────────────────────────────────────────────────────────────

interface ItemImageProps {
  itemId: string;
  itemAssets?: Record<string, string>;
  size?: number;
  className?: string;
}

export function ItemImage({
  itemId,
  itemAssets,
  size = 24,
  className = "",
}: ItemImageProps) {
  const [failed, setFailed] = useState(false);
  const src = itemAssets?.[itemId] || itemImageUrl(itemId);
  const displayName = itemId
    .replace(/^TFT\d*_Item_/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();

  if (!src || failed) {
    return (
      <div
        className={`rounded bg-tft-surface border border-tft-border flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}
        title={displayName}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-tft-muted"
          style={{ width: size * 0.55, height: size * 0.55 }}
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={displayName}
      width={size}
      height={size}
      className={`object-cover rounded shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={displayName}
      onError={() => setFailed(true)}
    />
  );
}
