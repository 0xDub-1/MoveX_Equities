"use client";

// =============================================================================
// Market card
// =============================================================================
//
// One rung of a daily ladder as a card. It reads top down the way a person
// decides: the question, how often it has come true lately, what each
// answer pays right now, and how long is left to take a side.

import Link from "next/link";

import { fmtEtTime } from "@/lib/calendar";
import { fmtBps, fmtMultiple, fmtPct, fmtUsdx } from "@/lib/format";
import {
  PHASE_META,
  SIDE_META,
  TIER_META,
  moveBps,
  payoutMultiple,
  phaseOf,
  pot,
  samplesCleared,
  sideAt,
  signedMovePct,
  type MarketPhase,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";

import { Badge, Countdown } from "@/components/ui/primitives";
import MoveMeter from "./MoveMeter";
import SideSplit, { SIDE_TEXT } from "./SideSplit";

function LiveBlock({ market, feed }: { market: MarketView; feed: PriceFeedView | undefined }) {
  const price = feed?.price;
  const ready = market.referencePrice > 0n && price !== undefined;
  const lead = ready ? sideAt(market, price) : null;
  return (
    <div className="rounded-md border border-line-2 bg-surface-1 px-3 py-3">
      <MoveMeter reference={market.referencePrice} current={price} strikeBps={market.strikeBps} />
      <p className={cn("mt-2.5 text-[13px] font-semibold", lead ? SIDE_TEXT[lead] : "text-text-3")}>
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
        "rounded-md border px-3 py-3",
        winner === "above" ? "border-above/40 bg-above/[0.07]" : "border-below/40 bg-below/[0.07]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-[14px] font-semibold", SIDE_TEXT[winner])}>
          {SIDE_META[winner].label} won
        </span>
        {measured && (
          <span className="font-mono text-[13px] tabular text-text-1">
            moved {fmtPct(signed, { signed: true })}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-text-3">
        {measured ? `${bps > market.strikeBps ? "Past" : "Within"} the ${fmtBps(market.strikeBps)} threshold. ` : ""}
        {SIDE_META[winner].label} paid {fmtMultiple(payoutMultiple(market, winner))}.
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
    case "settled":
      return <span>Settled {fmtEtTime(market.settleTs)} ET</span>;
    case "voided":
      return <span className="text-loss">Voided, refunds open</span>;
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
  const cleared = samplesCleared(market);
  const unit = market.kind === "daily" ? "sessions" : "hours";

  return (
    <Link
      href={`/market/${market.key}`}
      className={cn(
        "group flex flex-col rounded-md border bg-surface-2 p-4 transition-colors",
        live
          ? "border-below/30 hover:border-below/50"
          : "border-line-2 hover:border-line-3 hover:bg-surface-3/80",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-3">
          {tier.label} · {tier.ordinal} percentile
        </span>
        <Badge tone={meta.tone} size="sm" dot={live} pulse={phase === "live"}>
          {meta.label}
        </Badge>
      </div>

      <h3 className="mt-2.5 text-[15.5px] font-semibold leading-snug tracking-tight text-text-1">
        Will {market.symbol} move more than{" "}
        <span className="font-mono tabular">{fmtBps(market.strikeBps)}</span>?
      </h3>
      <p className="mt-1 text-[12.5px] text-text-3">
        It did in {cleared} of the last {market.samplesBps.length} {unit}.
      </p>

      <div className="mt-4">
        {(phase === "deposits" || phase === "awaiting-lock") && (
          <SideSplit market={market} amounts={false} />
        )}
        {live && (
          <>
            <LiveBlock market={market} feed={feed} />
            <SideSplit market={market} size="sm" chips={false} className="mt-3" />
          </>
        )}
        {phase === "settled" && <SettledBlock market={market} />}
        {phase === "voided" && (
          <div className="rounded-md border border-loss/30 bg-loss/[0.06] px-3 py-3 text-[13px] text-loss">
            This market never settled. Every deposit is refunded in full.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-1 pt-3 font-mono text-[12px] tabular text-text-3">
        <span>
          Pot <span className="text-text-1">{fmtUsdx(pot(market), { compact: true })}</span> USDX
        </span>
        <FooterClock market={market} phase={phase} />
      </div>
    </Link>
  );
}
