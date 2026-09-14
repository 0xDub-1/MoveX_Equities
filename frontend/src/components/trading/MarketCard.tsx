"use client";

// =============================================================================
// Market card
// =============================================================================
//
// One market as a card: the threshold as the headline, the pools, and what
// matters for its phase. A rung of a daily ladder or a slot of an hourly
// session, the same component either way.

import Link from "next/link";
import { ArrowUpRight, Check, Lock } from "lucide-react";

import { fmtEtTime } from "@/lib/calendar";
import { fmtBps, fmtPct, fmtUsdx } from "@/lib/format";
import {
  PHASE_META,
  SIDE_META,
  TIER_META,
  moveBps,
  phaseOf,
  pot,
  signedMovePct,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";

import { Badge, Countdown, SideTag } from "@/components/ui/primitives";
import MoveMeter from "./MoveMeter";
import PoolBar from "./PoolBar";

export default function MarketCard({
  market,
  now,
  feed,
  variant = "rung",
  className,
}: {
  market: MarketView;
  now: number;
  feed: PriceFeedView | undefined;
  /** `rung` leads with the tier, `slot` leads with the hour window. */
  variant?: "rung" | "slot";
  className?: string;
}) {
  const phase = phaseOf(market, now);
  const meta = PHASE_META[phase];
  const tier = TIER_META[market.tier];
  const live = phase === "live" || phase === "awaiting-settle";
  const resolved = phase === "settled" || phase === "voided";
  const isSlot = variant === "slot";

  const finalMove =
    market.state === "settled" && market.referencePrice > 0n
      ? {
          bps: moveBps(market.referencePrice, market.settlementPrice),
          signed: signedMovePct(market.referencePrice, market.settlementPrice),
        }
      : null;

  return (
    <Link
      href={`/market/${market.key}`}
      className={cn(
        "group relative flex flex-col rounded-md border bg-surface-1 surface-highlight overflow-hidden transition-colors",
        "hover:bg-surface-2/70",
        phase === "deposits" && "border-line-1 hover:border-line-3",
        live && "border-below/25 hover:border-below/45",
        phase === "awaiting-lock" || phase === "awaiting-settle" ? "border-warning/20" : "",
        resolved && "border-line-1 hover:border-line-2",
        className,
      )}
    >
      <div className={cn("flex flex-col gap-3", isSlot ? "p-3.5" : "p-4")}>
        {/* Head */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {isSlot ? (
              <div className="font-mono text-[12px] font-semibold tabular text-text-1">
                {fmtEtTime(market.lockTs)}
                <span className="text-text-4"> to </span>
                {fmtEtTime(market.settleTs)}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-semibold tracking-[0.18em] uppercase text-text-1">
                  {tier.label}
                </span>
                <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-text-4">
                  {tier.percentile}
                </span>
              </div>
            )}
          </div>
          <Badge tone={meta.tone} size="sm" dot={live} pulse={phase === "live"}>
            {meta.label}
          </Badge>
        </div>

        {/* Threshold */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={cn(
                "font-display font-semibold tabular tracking-tight text-text-1 leading-none",
                isSlot ? "text-[22px]" : "text-[30px]",
              )}
            >
              {fmtBps(market.strikeBps)}
            </span>
            {!isSlot && (
              <span className="text-[11px] text-text-3 truncate">{tier.question}</span>
            )}
          </div>
          {isSlot && (
            <span className="font-mono text-[10px] tabular text-text-3 whitespace-nowrap">
              pot {fmtUsdx(pot(market), { compact: true })}
            </span>
          )}
        </div>

        {/* Body by phase */}
        {phase === "deposits" && (
          <>
            <PoolBar market={market} size="sm" showPayouts={!isSlot} />
            <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] tabular">
              <span className="text-text-3">
                Locks in <Countdown to={market.lockTs} className="text-text-1" />
              </span>
              <span className="inline-flex items-center gap-1 text-brand opacity-0 group-hover:opacity-100 transition-opacity">
                Trade <ArrowUpRight size={11} />
              </span>
            </div>
          </>
        )}

        {phase === "awaiting-lock" && (
          <>
            <PoolBar market={market} size="sm" showPayouts={!isSlot} />
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-warning">
              <Lock size={11} />
              Deposits closed. Recording the reference price.
            </div>
          </>
        )}

        {live && (
          <>
            <MoveMeter
              reference={market.referencePrice}
              current={feed?.price}
              strikeBps={market.strikeBps}
            />
            <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] tabular">
              <LeadingLabel market={market} feed={feed} />
              {phase === "live" ? (
                <span className="text-text-3">
                  Settles in <Countdown to={market.settleTs} className="text-text-1" />
                </span>
              ) : (
                <span className="text-warning">Settling</span>
              )}
            </div>
            {!isSlot && <PoolBar market={market} size="sm" showPayouts={false} />}
          </>
        )}

        {phase === "settled" && market.winningSide && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SideTag side={market.winningSide} size="sm" />
                <span className="font-mono text-[10.5px] text-text-3 uppercase tracking-[0.12em]">won</span>
              </div>
              {finalMove && (
                <span
                  className={cn(
                    "font-mono text-[11px] tabular",
                    market.winningSide === "above" ? "text-above" : "text-below",
                  )}
                >
                  moved {fmtPct(finalMove.signed, { signed: true })}
                </span>
              )}
            </div>
            <PoolBar market={market} size="sm" highlight={market.winningSide} showPayouts={!isSlot} />
          </>
        )}

        {phase === "voided" && (
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-loss">
            <Check size={11} />
            Voided. Deposits refund in full.
          </div>
        )}
      </div>
    </Link>
  );
}

function LeadingLabel({ market, feed }: { market: MarketView; feed: PriceFeedView | undefined }) {
  if (!feed || market.referencePrice === 0n) {
    return <span className="text-text-4">Waiting for a price</span>;
  }
  const bps = moveBps(market.referencePrice, feed.price);
  const above = bps > market.strikeBps;
  return (
    <span className={above ? "text-above" : "text-below"}>
      {SIDE_META[above ? "above" : "below"].label} leading
    </span>
  );
}
