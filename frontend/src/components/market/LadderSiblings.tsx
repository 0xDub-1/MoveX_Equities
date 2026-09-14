"use client";

// =============================================================================
// 05 Ladder, or Session
// =============================================================================
//
// The other markets this one belongs with. A daily market sits on a ladder
// of three thresholds for the same session; an hourly one sits in a row of
// slots across the trading day. Each cell is a link, the current one is not.

import Link from "next/link";

import { fmtEtDay, fmtEtTime, fmtSessionDate } from "@/lib/calendar";
import { QUOTE_SYMBOL } from "@/lib/config";
import { fmtBps, fmtUsdx } from "@/lib/format";
import { TIER_META, phaseOf, pot, type MarketView } from "@/lib/market";
import { cn } from "@/lib/utils";
import { SectionHeader, Surface, TierTag } from "@/components/ui/primitives";
import PoolBar from "@/components/trading/PoolBar";

import PhaseBadge from "./PhaseBadge";

function RungCell({ market, current, now }: { market: MarketView; current: boolean; now: number }) {
  const body = (
    <>
      {current && <span className="absolute inset-x-0 top-0 h-px bg-brand/60" aria-hidden />}
      <div className="flex items-center justify-between gap-2">
        <TierTag tier={market.tier} active={current} />
        <PhaseBadge phase={phaseOf(market, now)} size="sm" />
      </div>
      <p className="mt-3 font-mono text-[20px] font-semibold tabular tracking-tight text-text-1">
        {fmtBps(market.strikeBps)}
      </p>
      <PoolBar market={market} size="sm" showPayouts={false} className="mt-3" />
    </>
  );
  const classes = cn(
    "relative block min-w-0 px-4 py-4",
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

function SlotCell({ market, current, now }: { market: MarketView; current: boolean; now: number }) {
  const body = (
    <>
      <p className="font-mono text-[11px] font-semibold tabular text-text-1">
        {fmtEtTime(market.lockTs)} to {fmtEtTime(market.settleTs)}{" "}
        <span className="font-medium text-text-4">ET</span>
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <PhaseBadge phase={phaseOf(market, now)} size="sm" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-4">
          {TIER_META[market.tier].label}
        </span>
      </div>
      <p className="mt-2.5 font-mono text-[11px] tabular text-text-3">
        pot <span className="text-text-1">{fmtUsdx(pot(market), { compact: true })}</span> {QUOTE_SYMBOL}
      </p>
    </>
  );
  const classes = cn(
    "block w-[164px] shrink-0 rounded-md border px-3 py-3",
    current
      ? "border-line-3 bg-white/[0.04]"
      : "border-line-1 bg-surface-1 transition-colors hover:border-line-2 hover:bg-white/[0.04]",
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
}: {
  market: MarketView;
  /** The group this market belongs to, itself included. */
  siblings: MarketView[];
  now: number;
}) {
  if (siblings.length < 2) return null;
  const daily = market.kind === "daily";

  return (
    <Surface as="section">
      <SectionHeader
        number="05"
        label={daily ? "Ladder" : "Session"}
        trailing={
          <span className="font-mono text-[10.5px] tabular text-text-3">
            {daily ? fmtSessionDate(market.sessionId) : fmtEtDay(market.lockTs)}
          </span>
        }
      />

      {daily ? (
        <div className="grid grid-cols-1 gap-px bg-line-1 sm:grid-cols-3">
          {siblings.map((m) => (
            <RungCell key={m.key} market={m} current={m.key === market.key} now={now} />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto px-4 sm:px-5 py-4">
          {siblings.map((m) => (
            <SlotCell key={m.key} market={m} current={m.key === market.key} now={now} />
          ))}
        </div>
      )}
    </Surface>
  );
}
