"use client";

// =============================================================================
// Move meter
// =============================================================================
//
// The compact cousin of MoveGauge for cards and table rows: how far the
// stock has moved, as a fraction of the threshold. The tick in the middle is
// the threshold; a fill past it means ABOVE is winning.

import { fmtPct } from "@/lib/format";
import { moveBps, signedMovePct } from "@/lib/market";
import { cn } from "@/lib/utils";

export default function MoveMeter({
  reference,
  current,
  strikeBps,
  className,
  showLabel = true,
}: {
  reference: bigint;
  current: bigint | undefined;
  strikeBps: number;
  className?: string;
  showLabel?: boolean;
}) {
  const ready = reference > 0n && current !== undefined;
  const bps = ready ? moveBps(reference, current) : 0;
  const signed = ready ? signedMovePct(reference, current) : 0;
  const above = ready && bps > strikeBps;
  // The tick sits at the midpoint, so full width is twice the threshold.
  const fill = ready ? Math.min(100, (bps / (strikeBps * 2)) * 100) : 0;

  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", className)}>
      <div className="relative h-1.5 flex-1 rounded-full bg-white/[0.06] overflow-visible">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500",
            above ? "bg-above" : "bg-below",
          )}
          style={{ width: `${fill}%` }}
        />
        <div className="absolute left-1/2 -top-1 h-[14px] w-px bg-white/50" />
      </div>
      {showLabel && (
        <span
          className={cn(
            "font-mono text-[11px] tabular whitespace-nowrap",
            !ready ? "text-text-4" : above ? "text-above" : "text-below",
          )}
        >
          {ready ? fmtPct(signed, { signed: true }) : "--"}
          <span className="text-text-4"> / {fmtPct(strikeBps / 100)}</span>
        </span>
      )}
    </div>
  );
}
