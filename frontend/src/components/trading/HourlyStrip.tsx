"use client";

// =============================================================================
// Hourly strip
// =============================================================================
//
// One ticker's intraday session: six one-hour slots in a row, each its own
// market, all sharing the day's threshold.

import { fmtEtDayLong } from "@/lib/calendar";
import { TICKER_NAMES, type Ticker } from "@/lib/config";
import type { MarketGroup } from "@/lib/groups";
import { fmtBps, fmtUsdx } from "@/lib/format";
import { phaseOf, pot, type PriceFeedView } from "@/lib/market";

import { Badge } from "@/components/ui/primitives";
import MarketCard from "./MarketCard";

export default function HourlyStrip({
  group,
  now,
  feed,
}: {
  group: MarketGroup;
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const lead = group.markets[0];
  const phases = group.markets.map((m) => phaseOf(m, now));
  const open = phases.filter((p) => p === "deposits").length;
  const live = phases.filter((p) => p === "live" || p === "awaiting-settle").length;
  const done = phases.filter((p) => p === "settled" || p === "voided").length;
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
            <Badge size="sm">Hourly</Badge>
            {live > 0 && (
              <Badge size="sm" tone="sky" dot pulse>
                {live} live
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12px] text-text-3">
            {fmtEtDayLong(group.lockTs)}. Each hour is its own market against a{" "}
            <span className="text-text-2 tabular">{fmtBps(lead.strikeBps)}</span> threshold.
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10.5px] tabular text-text-3 shrink-0">
          <span>
            Pot <span className="text-text-1">{fmtUsdx(total, { compact: true })}</span> USDX
          </span>
          <span>
            <span className="text-text-1">{open}</span> open · <span className="text-text-1">{done}</span> settled
          </span>
        </div>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {group.markets.map((m) => (
          <MarketCard key={m.key} market={m} now={now} feed={feed} variant="slot" />
        ))}
      </div>
    </section>
  );
}
