"use client";

// =============================================================================
// Move meter
// =============================================================================
//
// How far the stock has moved, as a fraction of the threshold. The tick in
// the middle is the threshold: a fill that reaches past it means YES is
// winning, a fill short of it means NO is.

import { fmtBps, fmtPct } from "@/lib/format";
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
  // The tick sits at the midpoint, so the full width is twice the threshold.
  const fill = ready ? Math.min(100, (bps / (strikeBps * 2)) * 100) : 0;

  return (
    <div className={cn("min-w-0", className)}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
          <span className="text-text-3">Moved so far</span>
          <span className="font-mono tabular text-text-1">
            {ready ? fmtPct(signed, { signed: true }) : "--"}
            <span className="text-text-3"> of {fmtBps(strikeBps)}</span>
          </span>
        </div>
      )}
      <div className="relative h-2 rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500",
            above ? "bg-above" : "bg-below",
          )}
          style={{ width: `${fill}%` }}
        />
        <div
          className="absolute left-1/2 -top-1 h-4 w-px bg-white/60"
          title={`Threshold ${fmtBps(strikeBps)}`}
        />
      </div>
    </div>
  );
}
