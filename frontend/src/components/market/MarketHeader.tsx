"use client";

// =============================================================================
// Market header
// =============================================================================
//
// Who, what and when. The ticker with its tags, the window in New York time
// and the question the market asks, with the threshold and the clock beside.

import { fmtEtDateTime } from "@/lib/calendar";
import { fmtBps } from "@/lib/format";
import type { MarketPhase, MarketView } from "@/lib/market";
import { Badge, Countdown, SideTag, Stat, TierTag } from "@/components/ui/primitives";

import PhaseBadge from "./PhaseBadge";
import { companyName, questionOf, windowOf } from "./helpers";

/** Word states sit a step smaller than the numeric ones so they never wrap. */
const WORD_VALUE = "font-display text-lg sm:text-xl text-text-2";

function Clock({ market, phase }: { market: MarketView; phase: MarketPhase }) {
  switch (phase) {
    case "deposits":
      return (
        <Stat
          label="Locks in"
          size="lg"
          value={<Countdown to={market.lockTs} />}
          sub={fmtEtDateTime(market.lockTs)}
        />
      );
    case "live":
      return (
        <Stat
          label="Settles in"
          size="lg"
          value={<Countdown to={market.settleTs} />}
          sub={fmtEtDateTime(market.settleTs)}
        />
      );
    case "awaiting-lock":
      return (
        <Stat
          label="Lock"
          size="lg"
          value="Awaiting lock"
          valueClassName={WORD_VALUE}
          sub={`Due ${fmtEtDateTime(market.lockTs)}`}
        />
      );
    case "awaiting-settle":
      return (
        <Stat
          label="Settlement"
          size="lg"
          value="Awaiting settlement"
          valueClassName={WORD_VALUE}
          sub={`Due ${fmtEtDateTime(market.settleTs)}`}
        />
      );
    case "settled":
      return (
        <Stat
          label="Settled"
          size="lg"
          value={
            <span className="inline-flex items-center gap-2">
              {market.winningSide && <SideTag side={market.winningSide} />}
              <span>won</span>
            </span>
          }
          valueClassName={WORD_VALUE}
          sub={fmtEtDateTime(market.settleTs)}
        />
      );
    case "voided":
      return (
        <Stat
          label="Status"
          size="lg"
          value="Voided"
          valueClassName={WORD_VALUE}
          sub="Deposits refunded in full"
        />
      );
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
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-text-1">
            {market.symbol}
          </h1>
          {name && <span className="text-[15px] text-text-3">{name}</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TierTag tier={market.tier} showPercentile />
          <Badge>{market.kind === "daily" ? "Daily" : "Hourly"}</Badge>
          <PhaseBadge phase={phase} />
        </div>

        <p className="mt-3 font-mono text-[11px] tabular text-text-3">{windowOf(market)}</p>
        <p className="mt-2 max-w-xl text-[14px] sm:text-[15px] leading-relaxed text-text-2">
          {questionOf(market)}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-4 md:shrink-0 md:gap-x-10">
        <Stat label="Threshold" size="lg" value={fmtBps(market.strikeBps)} sub="either direction" />
        <Clock market={market} phase={phase} />
      </div>
    </header>
  );
}
