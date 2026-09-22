"use client";

// =============================================================================
// 05 Ladder, or Session
// =============================================================================
//
// The other markets this one belongs with. A daily market sits on a ladder
// of three thresholds for the same session; an hourly one sits among the
// hours of the same day. Every cell has the anatomy of a board card in
// miniature: the slot, the question, the two prices, the two answers. Each
// cell is a link, the current one is not.

import Link from "next/link";

import { venueOfSymbol } from "@/lib/assets";
import { slotLabel } from "@/lib/board";
import { fmtSessionDate } from "@/lib/calendar";
import { fmtDay } from "@/lib/clock";
import { fmtBps, fmtPct, fmtPrice } from "@/lib/format";
import {
  phaseOf,
  priceToNumber,
  signedMovePct,
  strikeBand,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { PhaseBadge, SectionHeader, Surface } from "@/components/ui/primitives";
import SideSplit from "@/components/trading/SideSplit";
import StrikeRail from "@/components/trading/StrikeRail";

function SiblingCell({
  market,
  current,
  now,
  feed,
}: {
  market: MarketView;
  current: boolean;
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const label = slotLabel(market);
  const band = strikeBand(market, feed?.price);
  const settled = market.state === "settled" && market.referencePrice > 0n && market.settlementPrice > 0n;
  const body = (
    <>
      {current && <span className="absolute inset-x-0 top-0 h-px bg-brand/60" aria-hidden />}
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-3">
          {label.main}
          <span className="text-text-4"> · {label.aside}</span>
        </span>
        <PhaseBadge phase={phaseOf(market, now)} size="sm" />
      </div>
      <p className="mt-2.5 text-[13.5px] font-semibold text-text-1">
        More than <span className="font-mono tabular">{fmtBps(market.strikeBps)}</span>?
      </p>
      {/* Once a market has paid out, where the price ended is the fact; the
          band it was measured against is on the card it came from. */}
      {settled ? (
        <p className="mt-2.5 flex min-h-[27px] items-center font-mono text-[11.5px] tabular text-text-2">
          <span className={cn("font-semibold", market.winningSide === "above" ? "text-above" : "text-below")}>
            {fmtPct(signedMovePct(market.referencePrice, market.settlementPrice), { signed: true })}
          </span>
          <span className="text-text-4">&nbsp;·&nbsp;</span>
          ended at {fmtPrice(priceToNumber(market.settlementPrice))}
        </p>
      ) : (
        <StrikeRail band={band} className="mt-2.5" />
      )}
      {/* A settled sibling names its winner, the same way a board card does. */}
      <SideSplit
        market={market}
        size="sm"
        amounts={false}
        highlight={market.state === "settled" ? market.winningSide : undefined}
        className="mt-3"
      />
    </>
  );
  const classes = cn(
    "relative block min-w-0 border-b border-r border-line-1 px-4 py-4",
    current ? "bg-white/[0.035]" : "bg-surface-1 transition-colors hover:bg-white/[0.04]",
  );
  if (current) {
    return (
      <div className={classes} aria-current="page">
        {body}
      </div>
    );
  }
  return (
    <Link href={`/market/${market.key}`} className={classes}>
      {body}
    </Link>
  );
}

export default function LadderSiblings({
  market,
  siblings,
  now,
  feed,
}: {
  market: MarketView;
  /** The group this market belongs to, itself included. */
  siblings: MarketView[];
  now: number;
  feed: PriceFeedView | undefined;
}) {
  if (siblings.length < 2) return null;
  const daily = market.kind === "daily";

  return (
    <Surface as="section">
      <SectionHeader
        number="05"
        label={daily ? "Ladder" : "Session"}
        trailing={
          <span className="font-mono text-[11.5px] tabular text-text-3">
            {daily ? fmtSessionDate(market.sessionId) : fmtDay(market.lockTs, venueOfSymbol(market.symbol))}
          </span>
        }
      />
      {/* The hairlines belong to the cells, not to the container: a row that
          does not fill its columns would otherwise leave a block of divider
          colour where the missing cells would have been. */}
      <div className="overflow-hidden">
        <div
          className={cn(
            "-mb-px -mr-px grid",
            daily ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {siblings.map((m) => (
            <SiblingCell key={m.key} market={m} current={m.key === market.key} now={now} feed={feed} />
          ))}
        </div>
      </div>
    </Surface>
  );
}
