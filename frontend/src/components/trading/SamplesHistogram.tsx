"use client";

// =============================================================================
// Samples histogram
// =============================================================================
//
// The twenty trailing moves the threshold was read from, sorted, with the
// threshold drawn across them. The bars past the line are the sessions that
// would have resolved ABOVE. It is the on-chain justification for the
// number, shown rather than asserted.

import { fmtBps } from "@/lib/format";
import { TIER_META, sampleScale, type Tier } from "@/lib/market";
import { cn } from "@/lib/utils";

export default function SamplesHistogram({
  samplesBps,
  strikeBps,
  tier,
  siblings = [],
  className,
  height = 96,
  unit = "sessions",
  label,
}: {
  samplesBps: number[];
  strikeBps: number;
  tier: Tier;
  /** Other rungs, drawn as faint lines. */
  siblings?: { tier: Tier; strikeBps: number }[];
  className?: string;
  height?: number;
  /** What one sample is: sessions for a daily market, hours for an hourly one. */
  unit?: string;
  /** What to call the threshold line. Defaults to the tier, which only a daily ladder has. */
  label?: string;
}) {
  // Shared with the board's spark, so one click never redraws the same
  // twenty numbers to a different scale.
  const max = sampleScale(samplesBps, strikeBps);
  const pct = (bps: number) => Math.min(100, (bps / max) * 100);
  const exceeded = samplesBps.filter((s) => s > strikeBps).length;
  const meta = TIER_META[tier];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative" style={{ height }}>
        {/* Sibling thresholds */}
        {siblings
          .filter((s) => s.tier !== tier)
          .map((s) => (
            <div
              key={s.tier}
              className="absolute left-0 right-0 border-t border-dashed border-white/[0.12]"
              style={{ bottom: `${pct(s.strikeBps)}%` }}
            >
              <span className="absolute right-0 -top-3.5 font-mono text-[8.5px] tracking-[0.14em] uppercase text-text-4">
                {TIER_META[s.tier].label} {fmtBps(s.strikeBps)}
              </span>
            </div>
          ))}

        {/* Bars */}
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {samplesBps.map((s, i) => {
            const over = s > strikeBps;
            return (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-t-[2px] transition-colors min-w-0",
                  over ? "bg-above/70" : "bg-below/55",
                )}
                style={{ height: `${Math.max(2, pct(s))}%` }}
                // The bars are sorted by size, so the index is a rank, not a date.
                title={`${i + 1} of ${samplesBps.length} by size: ${fmtBps(s)}`}
              />
            );
          })}
        </div>

        {/* This market's threshold */}
        <div
          className="absolute left-0 right-0 border-t-[1.5px] border-text-1"
          style={{ bottom: `${pct(strikeBps)}%` }}
        >
          <span className="absolute left-0 -top-4 font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase text-text-1 bg-surface-1/90 pr-1.5">
            {label ?? meta.label} {fmtBps(strikeBps)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] tabular text-text-3">
        <span>
          <span className="text-above">{exceeded}</span> of {samplesBps.length} {unit} exceeded it
        </span>
        <span>
          {fmtBps(samplesBps[0] ?? 0)} to {fmtBps(samplesBps[samplesBps.length - 1] ?? 0)}
        </span>
      </div>
    </div>
  );
}
