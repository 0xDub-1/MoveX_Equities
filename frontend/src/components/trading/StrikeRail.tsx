"use client";

// =============================================================================
// Strike rail
// =============================================================================
//
// The threshold in dollars. "More than 2.35%" is the rule the program runs,
// but nobody holds a percentage: what decides the market is two prices, so
// this puts them where the question is asked rather than one click away.
//
// Three values, widest apart: the price below which YES wins, the price the
// band is measured from, and the price above which YES wins. Before lock the
// middle one is the live print and the ends follow it, which the caption says
// out loud instead of dressing a moving number up as a strike.

import { fmtPrice } from "@/lib/format";
import type { StrikeBand } from "@/lib/market";
import { cn } from "@/lib/utils";

function End({
  price,
  caption,
  align = "left",
}: {
  price: number;
  caption: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0 whitespace-nowrap", align === "right" && "text-right")}>
      <p className="font-mono text-[12.5px] font-semibold leading-none tabular text-text-1">
        {fmtPrice(price)}
      </p>
      <p className="mt-1 text-[10.5px] font-medium leading-none text-above">{caption}</p>
    </div>
  );
}

export default function StrikeRail({ band, className }: { band: StrikeBand; className?: string }) {
  return (
    <div
      className={cn("@container flex items-start justify-between gap-2", className)}
      title={
        band.provisional
          ? "The threshold is measured from the price recorded at lock. Until then these two prices follow the live print."
          : "Measured from the price recorded at lock. YES wins outside these two prices."
      }
    >
      <End price={band.lower} caption="YES below" />

      {/*
        The two strikes are the answer; the price they are measured from is
        context, and it is already on screen in the group header or the
        gauge. So in a cell too narrow to hold all three it is the one that
        goes, rather than letting three fixed-width numbers collide. The
        threshold is generous on purpose: a four figure ticker needs it.
      */}
      <div className="hidden min-w-0 whitespace-nowrap text-center @min-[240px]:block">
        <p className="font-mono text-[12.5px] leading-none tabular text-text-2">
          {fmtPrice(band.anchor)}
        </p>
        <p className="mt-1 text-[10.5px] font-medium leading-none text-text-4">
          {band.provisional ? "live now" : "reference"}
        </p>
      </div>

      <End price={band.upper} caption="YES above" align="right" />
    </div>
  );
}
