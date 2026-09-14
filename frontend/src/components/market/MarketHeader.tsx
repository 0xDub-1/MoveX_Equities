"use client";

// =============================================================================
// Market header
// =============================================================================
//
// The question this market asks, who it is about, and when it is decided.
// The question is the product, so it gets the display type; the ticker and
// the tags sit above it as context.

import { fmtEtDateTime } from "@/lib/calendar";
import { VOID_GRACE_SECS } from "@/lib/config";
import { fmtBps } from "@/lib/format";
import type { MarketPhase, MarketView } from "@/lib/market";
import { Badge, Countdown, Eyebrow, SideTag, TierTag } from "@/components/ui/primitives";

import PhaseBadge from "./PhaseBadge";
import { companyName, questionOf, windowOf } from "./helpers";

/** One right-hand readout: a label over a large value over a caption. */
function Readout({
  label,
  value,
  sub,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Word values sit a step smaller so they never wrap. */
  wide?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Eyebrow size="sm">{label}</Eyebrow>
      <p
        className={
          wide
            ? "mt-1.5 font-display text-[19px] font-semibold leading-none tracking-tight text-text-2"
            : "mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight text-text-1 tabular"
        }
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 font-mono text-[11.5px] tabular text-text-3">{sub}</p>}
    </div>
  );
}

function Clock({ market, phase }: { market: MarketView; phase: MarketPhase }) {
  switch (phase) {
    case "deposits":
      return (
        <Readout
          label="Locks in"
          value={<Countdown to={market.lockTs} />}
          sub={fmtEtDateTime(market.lockTs)}
        />
      );
    case "live":
      return (
        <Readout
          label="Settles in"
          value={<Countdown to={market.settleTs} />}
          sub={fmtEtDateTime(market.settleTs)}
        />
      );
    case "awaiting-lock":
      return <Readout label="Lock" value="Awaiting" wide sub={`Due ${fmtEtDateTime(market.lockTs)}`} />;
    case "awaiting-settle":
      return (
        <Readout label="Settlement" value="Awaiting" wide sub={`Due ${fmtEtDateTime(market.settleTs)}`} />
      );
    case "settled":
      return (
        <Readout
          label="Result"
          value={
            <span className="inline-flex items-center gap-2">
              {market.winningSide && <SideTag side={market.winningSide} />}
              <span>won</span>
            </span>
          }
          wide
          sub={fmtEtDateTime(market.settleTs)}
        />
      );
    case "expired":
      return (
        <Readout
          label="Refund"
          value={<Countdown to={market.settleTs + VOID_GRACE_SECS} done="Open now" />}
          sub="Could not resolve, refunded in full"
        />
      );
    case "voided":
      return <Readout label="Status" value="Voided" wide sub="Deposits refunded in full" />;
  }
}

export default function MarketHeader({
  market,
  phase,
}: {
  market: MarketView;
  phase: MarketPhase;
}) {
  const name = companyName(market.symbol);

  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-[28px] font-semibold leading-none tracking-tight text-text-1">
            {market.symbol}
          </h1>
          {name && <span className="text-[14px] text-text-3">{name}</span>}
          <span className="hidden h-4 w-px bg-line-2 sm:block" />
          <TierTag tier={market.tier} showPercentile />
          <Badge>{market.kind === "daily" ? "Daily" : "Hourly"}</Badge>
          <PhaseBadge phase={phase} />
        </div>

        <p className="mt-4 max-w-2xl font-display text-[19px] font-semibold leading-[1.35] tracking-[-0.01em] text-text-1 sm:text-[22px]">
          {questionOf(market)}
        </p>
        <p className="mt-2.5 font-mono text-[11.5px] tabular text-text-3">{windowOf(market)}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-start gap-x-10 gap-y-5">
        <Readout label="Threshold" value={fmtBps(market.strikeBps)} sub="either direction" />
        <Clock market={market} phase={phase} />
      </div>
    </header>
  );
}
