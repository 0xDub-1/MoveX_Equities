"use client";

// =============================================================================
// Market card
// =============================================================================
//
// One rung of a daily ladder. It reads top down the way a person decides:
// the question, how often it has come true lately, what each answer pays
// right now, and how long is left to take a side.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { venueOfSymbol } from "@/lib/assets";
import { fmtTimeTz } from "@/lib/clock";
import { fmtBps, fmtMultiple, fmtPct, fmtUsdx } from "@/lib/format";
import {
  PHASE_META,
  SIDE_META,
  TIER_META,
  moveBps,
  payoutMultiple,
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

import { Badge, Countdown } from "@/components/ui/primitives";
import MoveMeter from "./MoveMeter";
import SamplesSpark from "./SamplesSpark";
import SideSplit, { SIDE_TEXT } from "./SideSplit";
import StrikeRail from "./StrikeRail";

function LiveBlock({ market, feed }: { market: MarketView; feed: PriceFeedView | undefined }) {
  const price = feed?.price;
  const ready = market.referencePrice > 0n && price !== undefined;
  const lead = ready ? sideAt(market, price) : null;
  return (
    <div className="rounded-md border border-line-2 bg-surface-1 px-3.5 py-3">
      <MoveMeter reference={market.referencePrice} current={price} strikeBps={market.strikeBps} />
      <p className={cn("mt-3 text-[13px] font-semibold", lead ? SIDE_TEXT[lead] : "text-text-3")}>
        {lead ? `${SIDE_META[lead].label} is winning right now` : "Waiting for a price"}
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
  return (
    <div
      className={cn(
        "rounded-md border px-3.5 py-3",
        winner === "above" ? "border-above/35 bg-above/[0.07]" : "border-below/35 bg-below/[0.07]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-[14.5px] font-semibold", SIDE_TEXT[winner])}>
          {SIDE_META[winner].label} won
        </span>
        {measured && (
          <span className="font-mono text-[13px] font-semibold tabular text-text-1">
            {fmtPct(signed, { signed: true })}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-text-2">
        {measured
          ? `Moved ${bps > market.strikeBps ? "past" : "within"} the ${fmtBps(market.strikeBps)} threshold. `
          : ""}
        Paid {fmtMultiple(payoutMultiple(market, winner))}.
      </p>
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
  className,
}: {
  market: MarketView;
  now: number;
  feed: PriceFeedView | undefined;
  className?: string;
}) {
  const phase = phaseOf(market, now);
  const meta = PHASE_META[phase];
  const tier = TIER_META[market.tier];
  const live = phase === "live" || phase === "awaiting-settle";
  const open = phase === "deposits" || phase === "awaiting-lock";
  const cleared = samplesCleared(market);
  const unit =
    market.kind === "hourly" ? "hours" : venueOfSymbol(market.symbol) === "crypto" ? "days" : "sessions";
  const band = strikeBand(market, feed?.price);

  return (
    <Link
      href={`/market/${market.key}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-surface-2 p-4 sm:p-5",
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

      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-3">
          {tier.label}
          <span className="text-text-4"> · {tier.ordinal} pct</span>
        </span>
        <Badge tone={meta.tone} size="sm" dot={live} pulse={phase === "live"}>
          {meta.label}
        </Badge>
      </div>

      <h3 className="mt-3 text-[16px] font-semibold leading-[1.35] tracking-[-0.01em] text-text-1">
        Will {market.symbol} move more than{" "}
        <span className="font-mono tabular">{fmtBps(market.strikeBps)}</span>?
      </h3>

      {/* The same question in prices, which is the form it is decided in. */}
      {band && <StrikeRail band={band} className="mt-3 border-t border-line-1 pt-3" />}

      <div className="mt-3.5 flex items-end gap-3">
        <SamplesSpark
          className="w-[104px] shrink-0"
          samplesBps={market.samplesBps}
          strikeBps={market.strikeBps}
        />
        <p className="min-w-0 text-[12px] leading-snug text-text-2">
          It did in{" "}
          <span className="font-mono font-semibold tabular text-text-1">{cleared}</span> of the last{" "}
          {market.samplesBps.length} {unit}
        </p>
      </div>

      <div className="mt-4">
        {open && <SideSplit market={market} amounts={false} />}
        {live && (
          <>
            <LiveBlock market={market} feed={feed} />
            <SideSplit market={market} size="sm" chips={false} className="mt-3" />
          </>
        )}
        {phase === "settled" && <SettledBlock market={market} />}
        {phase === "expired" && (
          <div className="rounded-md border border-loss/25 bg-loss/[0.05] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-loss">Missed its moment</p>
            <p className="mt-1 text-[12px] leading-relaxed text-text-2">
              No price arrived close enough to{" "}
              {market.state === "open" ? "the lock" : "settlement"}, so this market cannot resolve.
              Every deposit is refunded in full, with no fee.
            </p>
          </div>
        )}
        {phase === "voided" && (
          <div className="rounded-md border border-loss/30 bg-loss/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-loss">
            This market never settled. Every deposit is refunded in full.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-1 pt-3 font-mono text-[12px] tabular text-text-3">
        <span>
          Pot <span className="text-text-1">{fmtUsdx(pot(market), { compact: true })}</span> USDX
        </span>
        <span className="flex items-center gap-1.5">
          <FooterClock market={market} phase={phase} />
          <ArrowUpRight
            size={12}
            className="text-text-4 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
      </div>
    </Link>
  );
}
