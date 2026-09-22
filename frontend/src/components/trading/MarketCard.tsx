"use client";

// =============================================================================
// Market card
// =============================================================================
//
// One card for every market on the board, hourly or daily. It reads top down
// the way a person decides: which slot this is, the question, the two prices
// that decide it, how often it has come true lately, what each answer pays
// right now, and how long is left to take a side.
//
// The only line that differs between an hourly and a daily card is the first
// one: a rung such as TIGHT · 25th pct, or an hour such as 14:00 to 15:00.
// Every other row is identical, so a grid of either reads as one system.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { venueOfSymbol } from "@/lib/assets";
import { sampleUnit, slotLabel } from "@/lib/board";
import { fmtTimeTz } from "@/lib/clock";
import { fmtBps, fmtPct, fmtPrice, fmtUsdx } from "@/lib/format";
import {
  SIDE_META,
  moveBps,
  priceToNumber,
  phaseOf,
  pot,
  refundableAt,
  samplesCleared,
  sideAt,
  signedMovePct,
  strikeBand,
  type MarketPhase,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";

import { Countdown, PhaseBadge } from "@/components/ui/primitives";
import MoveMeter from "./MoveMeter";
import SamplesSpark from "./SamplesSpark";
import SideSplit, { SIDE_TEXT } from "./SideSplit";
import StrikeRail from "./StrikeRail";

function LiveBlock({ market, feed }: { market: MarketView; feed: PriceFeedView | undefined }) {
  const price = feed?.price;
  const ready = market.referencePrice > 0n && price !== undefined;
  const lead = ready ? sideAt(market, price) : null;
  return (
    <div className="rounded-md border border-line-2 bg-surface-1 px-3 py-2.5">
      <MoveMeter reference={market.referencePrice} current={price} strikeBps={market.strikeBps} />
      <p className={cn("mt-2 text-[12.5px] font-semibold", lead ? SIDE_TEXT[lead] : "text-text-3")}>
        {lead ? `${SIDE_META[lead].label} leading` : "Waiting for a price"}
      </p>
    </div>
  );
}

function SettledBlock({ market }: { market: MarketView }) {
  const winner = market.winningSide;
  if (!winner) return null;
  const measured = market.referencePrice > 0n;
  const bps = measured ? moveBps(market.referencePrice, market.settlementPrice) : 0;
  const signed = measured ? signedMovePct(market.referencePrice, market.settlementPrice) : 0;
  const ended = market.settlementPrice > 0n;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        winner === "above" ? "border-above/35 bg-above/[0.07]" : "border-below/35 bg-below/[0.07]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-[13.5px] font-semibold", SIDE_TEXT[winner])}>
          {SIDE_META[winner].label} won
        </span>
        {measured && (
          <span className="font-mono text-[12.5px] font-semibold tabular text-text-1">
            {fmtPct(signed, { signed: true })}
          </span>
        )}
      </div>
      {measured && (
        <p className="mt-1 text-[11.5px] text-text-2">
          {bps > market.strikeBps ? "Past" : "Within"} {fmtBps(market.strikeBps)}
          {ended ? `, ending at ${fmtPrice(priceToNumber(market.settlementPrice))}` : ""}.
        </p>
      )}
    </div>
  );
}

function FooterClock({ market, phase }: { market: MarketView; phase: MarketPhase }) {
  switch (phase) {
    case "deposits":
      return (
        <span>
          Locks in <Countdown to={market.lockTs} className="text-text-1" />
        </span>
      );
    case "live":
      return (
        <span>
          Settles in <Countdown to={market.settleTs} className="text-text-1" />
        </span>
      );
    case "awaiting-lock":
      return <span className="text-warning">Locking now</span>;
    case "awaiting-settle":
      return <span className="text-warning">Settling now</span>;
    case "expired":
      return (
        <span className="text-loss">
          Refunds in <Countdown to={refundableAt(market)} className="text-loss" done="moments" />
        </span>
      );
    case "settled":
      return <span>Settled {fmtTimeTz(market.settleTs, venueOfSymbol(market.symbol))}</span>;
    case "voided":
      return <span className="text-loss">Refunds open</span>;
  }
}

export default function MarketCard({
  market,
  now,
  feed,
  mutedStrike = false,
  levelFrom = "sm",
  className,
}: {
  market: MarketView;
  now: number;
  feed: PriceFeedView | undefined;
  /** Every hour of the day shares this threshold; the header says it once, the card says it quietly. */
  mutedStrike?: boolean;
  /** The width at which this card's grid gains a second column and the question row has to level. */
  levelFrom?: "sm" | "md";
  className?: string;
}) {
  const phase = phaseOf(market, now);
  const live = phase === "live" || phase === "awaiting-settle";
  const open = phase === "deposits" || phase === "awaiting-lock";
  const label = slotLabel(market);
  const band = strikeBand(market, feed?.price);
  const cleared = samplesCleared(market);

  return (
    <Link
      id={market.key}
      href={`/market/${market.key}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-surface-2 p-4 scroll-mt-32",
        "transition-[border-color,background-color,transform,box-shadow] duration-200",
        "hover:-translate-y-px hover:shadow-lg hover:shadow-black/30",
        live ? "border-below/25 hover:border-below/45" : "border-line-2 hover:border-line-3",
        className,
      )}
    >
      {/* A one pixel highlight along the top edge. */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
        aria-hidden
      />

      {/* 1. Which slot this is. The one row that differs between the two kinds. */}
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-3">
          {label.main}
          <span className="text-text-4"> · {label.aside}</span>
        </span>
        <PhaseBadge phase={phase} size="sm" />
      </div>

      {/* 2. The question. Pinned to two lines so a grid stays level. */}
      <h3
        className={cn(
          "mt-3 text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-text-1",
          levelFrom === "md" ? "md:min-h-[2.6em]" : "sm:min-h-[2.6em]",
        )}
      >
        Will {market.symbol} move more than{" "}
        <span className={cn("font-mono tabular", mutedStrike && "font-medium text-text-2")}>
          {fmtBps(market.strikeBps)}
        </span>
        ?
      </h3>

      {/* 3. The same question in prices, which is the form it is decided in. */}
      <div className="mt-3 border-t border-line-1 pt-3">
        <StrikeRail band={band} />
      </div>

      {/* 4. The evidence behind the number: the twenty moves it was read from,
             the threshold drawn across them. Full width, one caption line, so
             every card in a row is the same height whatever the count. */}
      <div className="mt-3.5">
        <SamplesSpark samplesBps={market.samplesBps} strikeBps={market.strikeBps} height={26} />
        <p className="mt-1.5 truncate text-[12px] leading-snug text-text-2">
          Cleared in <span className="font-mono font-semibold tabular text-text-1">{cleared}</span> of the last{" "}
          {market.samplesBps.length} {sampleUnit(market)}
        </p>
      </div>

      {/* 5. Where the market stands. */}
      <div className="mt-4">
        {open && <SideSplit market={market} size="sm" amounts={false} />}
        {live && (
          <>
            <LiveBlock market={market} feed={feed} />
            <SideSplit market={market} size="sm" amounts={false} className="mt-2.5" />
          </>
        )}
        {phase === "settled" && (
          <>
            <SettledBlock market={market} />
            <SideSplit market={market} size="sm" amounts={false} highlight={market.winningSide} className="mt-2.5" />
          </>
        )}
        {phase === "expired" && (
          <div className="rounded-md border border-loss/25 bg-loss/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-text-2">
            <span className="font-semibold text-loss">Missed its moment.</span> Every deposit is refunded in
            full, no fee.
          </div>
        )}
        {phase === "voided" && (
          <div className="rounded-md border border-loss/30 bg-loss/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-loss">
            Never settled. Every deposit is refunded in full.
          </div>
        )}
      </div>

      {/* 6. Pot and clock. */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-1 pt-3 font-mono text-[12px] tabular text-text-3">
        <span>
          Pot <span className="text-text-1">{fmtUsdx(pot(market), { compact: true })}</span> USDX
        </span>
        <span className="flex items-center gap-1.5">
          <FooterClock market={market} phase={phase} />
          <ArrowUpRight size={12} className="text-text-4 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}
