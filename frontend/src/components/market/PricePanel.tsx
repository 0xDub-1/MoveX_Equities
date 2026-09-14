"use client";

// =============================================================================
// 01 Price against the threshold
// =============================================================================
//
// The gauge, the four numbers behind it, and one sentence that says what
// they mean. Settled markets read from the record, live ones from the feed.

import type { ReactNode } from "react";

import { fmtEtDateTime } from "@/lib/calendar";
import { fmtAgo, fmtBps, fmtPct, fmtPrice } from "@/lib/format";
import {
  SIDE_META,
  leadingSide,
  moveBps,
  priceToNumber,
  signedMovePct,
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
    <div className="min-w-0 bg-surface-1 px-4 sm:px-5 py-3.5">
      <Stat
        label={label}
        value={value}
        sub={sub ? <span className={subClassName}>{sub}</span> : undefined}
        valueClassName={cn("font-mono", valueClassName)}
      />
    </div>
  );
}

function describe(
  market: MarketView,
  phase: MarketPhase,
  leading: Side | null,
  bps: number,
  measured: boolean,
): string {
  const strike = fmtBps(market.strikeBps);
  const past = bps > market.strikeBps ? "past" : "within";
  switch (phase) {
    case "deposits":
      return "The reference price will be recorded at lock. The thresholds are shown around the live price for now.";
    case "awaiting-lock":
      return "Deposits have closed. The reference price is recorded when the crank locks the market, and the thresholds settle around it.";
    case "live":
    case "awaiting-settle": {
      if (!measured || !leading) {
        return "Waiting for a live price. The feed publishes about once a minute.";
      }
      const tail = phase === "awaiting-settle" ? " Settlement is waiting on the crank." : "";
      return `${market.symbol} has moved ${fmtBps(bps)} from the reference, ${past} the ${strike} threshold. ${SIDE_META[leading].label} is winning.${tail}`;
    }
    case "settled": {
      const winner = market.winningSide ? SIDE_META[market.winningSide].label : "Nobody";
      if (!measured) return `Settled. ${winner} won.`;
      return `${market.symbol} moved ${fmtBps(bps)} from the reference, ${past} the ${strike} threshold. ${winner} won.`;
    }
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
  const bps = hasReference && current !== undefined ? moveBps(reference, current) : 0;
  const signed = hasReference && current !== undefined ? signedMovePct(reference, current) : 0;
  const fresh = isFeedFresh(feed, now);

  const standing = (() => {
    switch (phase) {
      case "settled":
        return market.winningSide ? `${SIDE_META[market.winningSide].label} won` : "Settled";
      case "voided":
        return "Voided";
      case "live":
      case "awaiting-settle":
        return leading ? `${SIDE_META[leading].label} leading` : "--";
      default:
        return "Preview";
    }
  })();

  return (
    <Surface as="section">
      <SectionHeader
        number="01"
        label="Price against the threshold"
        trailing={
          feed && !settled ? (
            <span className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-3">
              <span className={cn("status-dot", !fresh && "idle")} />
              {fresh ? "Feed live" : "Feed stale"}
            </span>
          ) : undefined
        }
      />

      <div className="px-4 sm:px-6 pt-5 pb-4">
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px border-t border-line-1 bg-line-1">
        <Cell
          label="Reference"
          value={hasReference ? fmtPrice(priceToNumber(reference)) : "Set at lock"}
          valueClassName={hasReference ? undefined : "text-text-3"}
          sub={fmtEtDateTime(market.lockTs)}
        />
        {settled ? (
          <Cell
            label="Settlement"
            value={fmtPrice(priceToNumber(market.settlementPrice))}
            sub={fmtEtDateTime(market.settleTs)}
          />
        ) : (
          <Cell
            label="Live"
            value={feed ? fmtPrice(priceToNumber(feed.price)) : "--"}
            valueClassName={feed ? undefined : "text-text-3"}
            sub={feed ? `${fmtAgo(now - feed.publishTime)}${fresh ? "" : ", stale"}` : "No feed"}
            subClassName={feed && !fresh ? "text-warning" : undefined}
          />
        )}
        <Cell
          label="Move"
          value={measured ? fmtPct(signed, { signed: true }) : "--"}
          valueClassName={measured ? sideText(leading) : "text-text-3"}
          sub={measured ? `${bps} / ${market.strikeBps} bps` : `Threshold ${market.strikeBps} bps`}
        />
        <Cell label="Standing" value={standing} valueClassName={sideText(leading)} />
      </div>

      <p className="border-t border-line-1 px-4 sm:px-5 py-3.5 text-[12.5px] leading-relaxed text-text-2">
        {describe(market, phase, leading, bps, measured)}
      </p>
    </Surface>
  );
}
