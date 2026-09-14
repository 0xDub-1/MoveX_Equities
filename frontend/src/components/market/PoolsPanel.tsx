"use client";

// =============================================================================
// 02 The two answers
// =============================================================================
//
// What each answer pays and how the pot is split between them. The numbers
// are the crowd's own, so a note reminds the reader they move with every
// deposit.

import { QUOTE_SYMBOL } from "@/lib/config";
import { fmtUsdx } from "@/lib/format";
import { pot, type MarketView } from "@/lib/market";
import { SectionHeader, Surface } from "@/components/ui/primitives";
import SideSplit from "@/components/trading/SideSplit";

import { feeLabel } from "./helpers";

export default function PoolsPanel({ market }: { market: MarketView }) {
  const settled = market.state === "settled";
  const total = pot(market);

  return (
    <Surface as="section">
      <SectionHeader
        number="02"
        label="The two answers"
        trailing={
          <span className="font-mono text-[12px] tabular text-text-3">
            Pot <span className="text-text-1">{fmtUsdx(total)}</span> {QUOTE_SYMBOL}
          </span>
        }
      />

      <div className="px-4 pb-4 pt-5 sm:px-5">
        <SideSplit market={market} size="lg" highlight={settled ? market.winningSide : undefined} />
      </div>

      <p className="border-t border-line-1 px-4 py-3 text-[12.5px] text-text-3 sm:px-5">
        The percentage is the share of the pot on that answer, which is the crowd&apos;s implied chance.
        The winning answer splits the pot less the {feeLabel(market.feeBps)} fee, so the less popular
        answer pays more. Both numbers move with every deposit.
      </p>
    </Surface>
  );
}
