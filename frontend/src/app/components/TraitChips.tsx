"use client";

import { computeTraits, type TraitInfo } from "@/lib/types";
import { TRAIT_TIER_STYLES } from "@/lib/constants";

export default function TraitChips({
  units,
  traitData,
  small = false,
}: {
  units: { traits: string[] }[];
  traitData: Record<string, TraitInfo>;
  small?: boolean;
}) {
  const traits = computeTraits(units, traitData);
  if (traits.length === 0) return null;
  return (
    <div className={`flex flex-wrap ${small ? "gap-0.5" : "gap-1"}`}>
      {traits.map((t) => {
        const style = TRAIT_TIER_STYLES[t.tier] ?? TRAIT_TIER_STYLES[1];
        const activeBp = t.isUnique ? t.breakpoints[0] : t.breakpoints[t.tier - 1];
        const nextBp = t.isUnique ? undefined : t.breakpoints[t.tier];
        const suffix = nextBp != null ? `${t.count}/${nextBp}` : `${t.count}`;
        return (
          <span
            key={t.name}
            className={`inline-flex items-center rounded border font-bold ${
              small
                ? "gap-0 pl-0.5 pr-1 h-5 text-[10px]"
                : "gap-0.5 pl-0.5 pr-1.5 h-6 text-xs"
            } ${style.chip}`}
            title={`${t.name} ${suffix} — breakpoints ${t.breakpoints.join("/")}`}
          >
            {t.icon && (
              <span
                className={`${small ? "w-3.5 h-3.5" : "w-4 h-4"} shrink-0 inline-block`}
                style={{
                  backgroundColor: style.iconColor,
                  WebkitMaskImage: `url(${t.icon})`,
                  maskImage: `url(${t.icon})`,
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                }}
              />
            )}
            <span className={style.num}>{activeBp}</span>
          </span>
        );
      })}
    </div>
  );
}
