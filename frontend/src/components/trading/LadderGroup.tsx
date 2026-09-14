"use client";

// =============================================================================
// Ladder group
// =============================================================================
//
// A daily ladder: one ticker, one session, three thresholds side by side.

import { fmtEtDateTime, fmtEtTime, fmtSessionDate } from "@/lib/calendar";
import { TICKER_NAMES, type Ticker } from "@/lib/config";
import type { MarketGroup } from "@/lib/groups";
import { fmtUsdx } from "@/lib/format";
import { PHASE_META, phaseOf, pot, type PriceFeedView } from "@/lib/market";

import { Badge, Countdown } from "@/components/ui/primitives";
import MarketCard from "./MarketCard";

export default function LadderGroup({
  group,
  now,
  feed,
}: {
  group: MarketGroup;
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const lead = group.markets[0];
  const phase = phaseOf(lead, now);
  const meta = PHASE_META[phase];
  const total = group.markets.reduce((sum, m) => sum + pot(m), 0n);

  return (
    <section className="animate-fade-up">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-2.5 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-display text-[19px] font-semibold tracking-tight text-text-1">
              {group.symbol}
            </span>
            <span className="text-[12px] text-text-3">{TICKER_NAMES[group.symbol as Ticker] ?? ""}</span>
            <Badge size="sm">Daily</Badge>
            <Badge size="sm" tone={meta.tone} dot={phase === "live"} pulse={phase === "live"}>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-text-3">
            Close to close, settling {fmtSessionDate(group.sessionId)} at {fmtEtTime(group.settleTs)} ET.
            <span className="hidden sm:inline"> Locks {fmtEtDateTime(group.lockTs)}.</span>
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10.5px] tabular text-text-3 shrink-0">
          <span>
            Pot <span className="text-text-1">{fmtUsdx(total, { compact: true })}</span> USDX
          </span>
          {phase === "deposits" && (
            <span>
              Locks in <Countdown to={group.lockTs} className="text-text-1" />
            </span>
          )}
          {phase === "live" && (
            <span>
              Settles in <Countdown to={group.settleTs} className="text-text-1" />
            </span>
          )}
        </div>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {group.markets.map((m) => (
          <MarketCard key={m.key} market={m} now={now} feed={feed} variant="rung" />
        ))}
      </div>
    </section>
  );
}
