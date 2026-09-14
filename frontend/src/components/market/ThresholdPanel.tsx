"use client";

// =============================================================================
// 03 How the threshold was set
// =============================================================================
//
// The twenty samples the strike was read from, and the sentence that turns a
// percentile into a base rate. Shown rather than asserted.

import { fmtBps } from "@/lib/format";
import { TIER_META, type MarketView } from "@/lib/market";
import { SectionHeader, Surface, TierTag } from "@/components/ui/primitives";
import SamplesHistogram from "@/components/trading/SamplesHistogram";
import type { GaugeSibling } from "@/components/trading/MoveGauge";

import { PERCENTILE_ORDINAL } from "./helpers";

export default function ThresholdPanel({
  market,
  rungs,
}: {
  market: MarketView;
  rungs: GaugeSibling[];
}) {
  const meta = TIER_META[market.tier];
  const span = market.kind === "daily" ? "close-to-close" : "one-hour";
  const count = market.samplesBps.length;

  return (
    <Surface as="section">
      <SectionHeader number="03" label="How the threshold was set" />

      <div className="grid gap-6 px-4 sm:px-5 py-5 sm:grid-cols-[minmax(0,1fr)_240px]">
        <SamplesHistogram
          className="pt-5"
          samplesBps={market.samplesBps}
          strikeBps={market.strikeBps}
          tier={market.tier}
          siblings={rungs}
          height={120}
        />

        <div className="flex flex-col gap-3 text-[12.5px] leading-relaxed text-text-2">
          <div className="flex items-center gap-2">
            <TierTag tier={market.tier} showPercentile />
            <span className="font-mono text-[12px] font-semibold tabular text-text-1">
              {fmtBps(market.strikeBps)}
            </span>
          </div>
          <p>
            {meta.label} is the {PERCENTILE_ORDINAL[market.tier]} percentile of the last {count} {span}{" "}
            moves. Historically about {meta.baseRate}% of sessions exceeded it.
          </p>
          <p className="text-text-3">
            The program recomputed this percentile from the {count} samples stored on chain and
            would have rejected the market if they disagreed.
          </p>
        </div>
      </div>
    </Surface>
  );
}
