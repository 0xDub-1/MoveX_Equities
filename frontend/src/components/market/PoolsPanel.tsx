"use client";

// =============================================================================
// 02 Pools
// =============================================================================
//
// Where the money sits and what each side pays. The multiples are the
// crowd's own odds, so a note reminds the reader they move with every deposit.

import { QUOTE_SYMBOL } from "@/lib/config";
import { fmtMultiple, fmtUsdx } from "@/lib/format";
import { payoutMultiple, pot, type MarketView } from "@/lib/market";
import { SectionHeader, Stat, Surface } from "@/components/ui/primitives";
import PoolBar from "@/components/trading/PoolBar";

import { feeLabel } from "./helpers";

export default function PoolsPanel({ market }: { market: MarketView }) {
  const settled = market.state === "settled";

  return (
    <Surface as="section">
      <SectionHeader number="02" label="Pools" />

      <div className="px-4 sm:px-5 pt-5 pb-4">
        <PoolBar market={market} size="md" highlight={settled ? market.winningSide : undefined} />
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-line-1 bg-line-1">
        <div className="min-w-0 bg-surface-1 px-4 sm:px-5 py-3.5">
          <Stat
            label="ABOVE pays"
            value={fmtMultiple(payoutMultiple(market, "above"))}
            sub="if it wins"
            valueClassName="font-mono text-above"
          />
        </div>
        <div className="min-w-0 bg-surface-1 px-3 py-3.5">
          <Stat
            label="Pot"
            value={fmtUsdx(pot(market))}
            sub={`${QUOTE_SYMBOL} · ${feeLabel(market.feeBps)} fee`}
            align="center"
            valueClassName="font-mono"
          />
        </div>
        <div className="min-w-0 bg-surface-1 px-4 sm:px-5 py-3.5">
          <Stat
            label="BELOW pays"
            value={fmtMultiple(payoutMultiple(market, "below"))}
            sub="if it wins"
            align="right"
            valueClassName="font-mono text-below"
          />
        </div>
      </div>

      <p className="border-t border-line-1 px-4 sm:px-5 py-3 text-[12px] text-text-3">
        Backing the less popular side pays more. Multiples move as deposits arrive.
      </p>
    </Surface>
  );
}
