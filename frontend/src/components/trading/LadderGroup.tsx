"use client";

// =============================================================================
// Ladder group
// =============================================================================
//
// A daily ladder: one ticker, one session, three thresholds side by side.

import { fmtEtDateTime, fmtEtTime, fmtSessionDate } from "@/lib/calendar";
import type { MarketGroup } from "@/lib/groups";
import { PHASE_META, phaseOf, pot, type PriceFeedView } from "@/lib/market";

import { Badge, Countdown } from "@/components/ui/primitives";
import GroupHeader from "./GroupHeader";
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
      <GroupHeader
        symbol={group.symbol}
        kind="Daily"
        feed={feed}
        now={now}
        pot={total}
        badge={
          <Badge size="sm" tone={meta.tone} dot={phase === "live"} pulse={phase === "live"}>
            {meta.label}
          </Badge>
        }
        description={
          <>
            Close to close, from {fmtEtDateTime(group.lockTs)} to {fmtSessionDate(group.sessionId)} at{" "}
            {fmtEtTime(group.settleTs)} ET.
            {/* Only true when the filters have not taken a rung away. */}
            {group.markets.length === 3 && " Three thresholds, three separate markets."}
          </>
        }
        trailing={
          phase === "deposits" ? (
            <span>
              Locks in <Countdown to={group.lockTs} className="text-text-1" />
            </span>
          ) : phase === "live" ? (
            <span>
              Settles in <Countdown to={group.settleTs} className="text-text-1" />
            </span>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {group.markets.map((m) => (
          <MarketCard key={m.key} market={m} now={now} feed={feed} />
        ))}
      </div>
    </section>
  );
}
