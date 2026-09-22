"use client";

// =============================================================================
// 01 Price against the threshold
// =============================================================================
//
// One sentence that says what has to happen, the gauge that shows it, and
// the four numbers behind it. Settled markets read from the record, live
// ones from the feed.

import type { ReactNode } from "react";

import { venueOfSymbol } from "@/lib/assets";
import { fmtDateTime } from "@/lib/clock";
import { fmtAgo, fmtBps, fmtDistance, fmtPct, fmtPrice } from "@/lib/format";
import {
  SIDE_META,
  leadingSide,
  moveBps,
  priceToNumber,
  signedMovePct,
  strikeDistance,
  type MarketPhase,
  type MarketView,
  type PriceFeedView,
  type Side,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { isFeedFresh } from "@/hooks/usePriceFeeds";
import { SectionHeader, Stat, Surface } from "@/components/ui/primitives";
import MoveGauge, { type GaugeSibling } from "@/components/trading/MoveGauge";

function sideText(side: Side | null): string | undefined {
  if (side === "above") return "text-above";
  if (side === "below") return "text-below";
  return undefined;
}

function Cell({
  label,
  value,
  sub,
  valueClassName,
  subClassName,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  subClassName?: string;
}) {
  return (
    <div className="min-w-0 bg-surface-1 px-4 py-3.5 sm:px-5">
      <Stat
        label={label}
        value={value}
        sub={sub ? <span className={subClassName}>{sub}</span> : undefined}
        valueClassName={cn("font-mono", valueClassName)}
      />
    </div>
  );
}

function headline(
  market: MarketView,
  phase: MarketPhase,
  leading: Side | null,
  signed: number,
  bps: number,
  measured: boolean,
): string {
  const strike = fmtBps(market.strikeBps);
  const ref = priceToNumber(market.referencePrice);
  const delta = strikeDistance(market.referencePrice, market.strikeBps);

  switch (phase) {
    case "deposits":
    case "awaiting-lock": {
      // The threshold in dollars, against the live print, because a
      // percentage of a number nobody is looking at decides nothing.
      return `The reference price is recorded at lock, ${fmtDateTime(market.lockTs, venueOfSymbol(market.symbol))}. From there ${market.symbol} needs to move more than ${strike}, up or down, for YES to win. Until then the band is drawn around the live price.`;
    }
    case "live":
    case "awaiting-settle": {
      const need = `${market.symbol} needs to move more than ${strike} from ${fmtPrice(ref)}, that is ${fmtDistance(delta)} up or down, for YES to win.`;
      if (!measured || !leading) return `${need} Waiting for a live price.`;
      const tail = phase === "awaiting-settle" ? " Settlement is waiting on the crank." : "";
      return `${need} So far it has moved ${fmtPct(signed, { signed: true })}, so ${SIDE_META[leading].label} is winning.${tail}`;
    }
    case "settled": {
      const winner = market.winningSide ? SIDE_META[market.winningSide].label : "Nobody";
      if (!measured) return `Settled. ${winner} won.`;
      return `${market.symbol} moved ${fmtPct(signed, { signed: true })}, from ${fmtPrice(ref)} to ${fmtPrice(priceToNumber(market.settlementPrice))}, ${bps > market.strikeBps ? "past" : "within"} the ${strike} threshold. ${winner} won.`;
    }
    case "expired":
      return `No price arrived close enough to ${market.state === "open" ? "the lock" : "the settlement"} for this market to resolve against the number it was sold on. It cannot lock or settle now, so every deposit is refunded in full, with no fee taken.`;
    case "voided":
      return "This market was voided before it could settle. Every deposit is refunded in full.";
  }
}

export default function PricePanel({
  market,
  phase,
  feed,
  now,
  rungs,
}: {
  market: MarketView;
  phase: MarketPhase;
  feed: PriceFeedView | undefined;
  now: number;
  rungs: GaugeSibling[];
}) {
  const settled = market.state === "settled";
  const reference = market.referencePrice;
  const hasReference = reference > 0n;
  const current = settled ? market.settlementPrice : feed?.price;
  const measured = hasReference && current !== undefined;
  const leading = current !== undefined ? leadingSide(market, current) : null;
  const bps = measured ? moveBps(reference, current) : 0;
  const signed = measured ? signedMovePct(reference, current) : 0;
  const fresh = isFeedFresh(feed, now);

  const winning = (() => {
    switch (phase) {
      case "settled":
        return market.winningSide ? `${SIDE_META[market.winningSide].label} won` : "Settled";
      case "voided":
        return "Voided";
      case "expired":
        return "Refund due";
      case "live":
      case "awaiting-settle":
        return leading ? `${SIDE_META[leading].label} winning` : "--";
      default:
        return "Not yet locked";
    }
  })();

  return (
    <Surface as="section">
      <SectionHeader
        number="01"
        label="Price against the threshold"
        trailing={
          feed && !settled ? (
            <span className="flex items-center gap-2 text-[11.5px] font-medium text-text-2">
              <span className={cn("status-dot", !fresh && "idle")} />
              <span className="hidden sm:inline">
                {fresh ? "Feed live" : `Last print ${fmtAgo(now - feed.publishTime)}`}
              </span>
            </span>
          ) : undefined
        }
      />

      <p className="px-4 pt-4 text-[14px] leading-relaxed text-text-2 sm:px-6">
        {headline(market, phase, leading, signed, bps, measured)}
      </p>

      <div className="px-4 pb-5 pt-6 sm:px-6">
        <MoveGauge
          reference={reference}
          current={current}
          strikeBps={market.strikeBps}
          tier={market.tier}
          state={market.state}
          winningSide={market.winningSide}
          siblings={rungs}
          provisional={!hasReference}
        />
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line-1 bg-line-1 xl:grid-cols-4">
        <Cell
          label="Reference price"
          value={hasReference ? fmtPrice(priceToNumber(reference)) : "Set at lock"}
          valueClassName={hasReference ? undefined : "text-text-3"}
          sub={fmtDateTime(market.lockTs, venueOfSymbol(market.symbol))}
        />
        {settled ? (
          <Cell
            label="Settlement price"
            value={fmtPrice(priceToNumber(market.settlementPrice))}
            sub={fmtDateTime(market.settleTs, venueOfSymbol(market.symbol))}
          />
        ) : (
          <Cell
            label="Live price"
            value={feed && feed.price > 0n ? fmtPrice(priceToNumber(feed.price)) : "--"}
            valueClassName={feed && feed.price > 0n ? undefined : "text-text-3"}
            sub={
              feed && feed.price > 0n
                ? `${fmtAgo(now - feed.publishTime)}${fresh ? "" : ", stale"}`
                : "No prints yet"
            }
            subClassName={feed && feed.price > 0n && !fresh ? "text-warning" : undefined}
          />
        )}
        <Cell
          label="Moved so far"
          value={measured ? fmtPct(signed, { signed: true }) : "--"}
          valueClassName={measured ? sideText(leading) : "text-text-3"}
          sub={`Needs more than ${fmtBps(market.strikeBps)}`}
        />
        <Cell label="Winning" value={winning} valueClassName={sideText(leading)} />
      </div>
    </Surface>
  );
}
