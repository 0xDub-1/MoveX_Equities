"use client";

// =============================================================================
// Samples spark
// =============================================================================
//
// The twenty trailing moves the threshold came from, as one small row of
// bars with the threshold drawn across them. The bars that clear the line
// are the sessions the market would have answered YES. Small enough to sit
// inside a card, and it carries the whole justification for the number.

import { fmtBps } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function SamplesSpark({
  samplesBps,
  strikeBps,
  className,
  height = 22,
}: {
  samplesBps: number[];
  strikeBps: number;
  className?: string;
  height?: number;
}) {
  // The tallest sample sets the scale, with headroom so the top bar and the
  // threshold line never touch the edge.
  const max = Math.max(...samplesBps, strikeBps) * 1.12 || 1;
  const line = (strikeBps / max) * 100;

  return (
    <div
      className={cn("relative flex items-end gap-[2px]", className)}
      style={{ height }}
      title={`The last ${samplesBps.length} moves against a ${fmtBps(strikeBps)} threshold`}
      aria-hidden="true"
    >
      {samplesBps.map((s, i) => {
        const cleared = s > strikeBps;
        return (
          <div
            key={i}
            className={cn(
              "min-w-0 flex-1 rounded-t-[1px]",
              cleared ? "bg-above/80" : "bg-below/45",
            )}
            style={{ height: `${Math.max(8, (s / max) * 100)}%` }}
          />
        );
      })}
      <div
        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/45"
        style={{ bottom: `${line}%` }}
      />
    </div>
  );
}
