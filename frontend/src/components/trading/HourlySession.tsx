"use client";

// =============================================================================
// Hourly session
// =============================================================================
//
// One ticker's intraday session: six one-hour markets against the day's
// threshold, as rows. A table reads better than six narrow cards because the
// only thing that differs between the hours is the numbers.

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { fmtEtDayLong, fmtEtTime } from "@/lib/calendar";
import { groupSummary, type MarketGroup } from "@/lib/groups";
import { fmtBps, fmtChance, fmtDistance, fmtMultiple, fmtPct, fmtUsdx } from "@/lib/format";
import {
  PHASE_META,
  SIDE_META,
  moveBps,
  payoutMultiple,
  phaseOf,
  poolShare,
  pot,
  refundableAt,
  samplesCleared,
  sideAt,
  signedMovePct,
  strikeDistance,
  type MarketPhase,
  type MarketView,
  type PriceFeedView,
  type Side,
} from "@/lib/market";
import { cn } from "@/lib/utils";

import { Badge, Countdown } from "@/components/ui/primitives";
import GroupHeader from "./GroupHeader";
import MoveMeter from "./MoveMeter";
import SideSplit, { SIDE_TEXT } from "./SideSplit";

const COLUMNS = "lg:grid-cols-[140px_96px_minmax(0,1fr)_minmax(0,1fr)_116px_148px_16px]";

function SideCell({ market, side }: { market: MarketView; side: Side }) {
  const empty = pot(market) === 0n;
  return (
    <div className="flex items-baseline gap-2.5 font-mono tabular">
      <span className={cn("text-[11.5px] font-semibold tracking-[0.06em]", SIDE_TEXT[side])}>
        {SIDE_META[side].label}
      </span>
      <span className="text-[16px] font-semibold leading-none text-text-1">
        {empty ? "--" : fmtChance(poolShare(market, side))}
      </span>
      <span className="text-[11.5px] text-text-3">
        pays <span className="text-text-2">{fmtMultiple(payoutMultiple(market, side))}</span>
      </span>
    </div>
  );
}

function Standing({ market, feed }: { market: MarketView; feed: PriceFeedView | undefined }) {
  const price = feed?.price;
  const ready = market.referencePrice > 0n && price !== undefined;
  const lead = ready ? sideAt(market, price) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <MoveMeter
        className="w-[132px] shrink-0"
        showLabel={false}
        reference={market.referencePrice}
        current={price}
        strikeBps={market.strikeBps}
      />
      <span className="font-mono text-[12.5px] tabular text-text-1">
        {ready ? fmtPct(signedMovePct(market.referencePrice, price), { signed: true }) : "--"}
        <span className="text-text-3"> of {fmtBps(market.strikeBps)}</span>
      </span>
      <span className={cn("text-[12.5px] font-semibold", lead ? SIDE_TEXT[lead] : "text-text-3")}>
        {lead ? `${SIDE_META[lead].label} winning` : "waiting for a price"}
      </span>
    </div>
  );
}

function Outcome({ market }: { market: MarketView }) {
  const winner = market.winningSide;
  if (!winner) return <span className="text-[13px] text-text-3">Settled</span>;
  const measured = market.referencePrice > 0n;
  const signed = measured ? signedMovePct(market.referencePrice, market.settlementPrice) : 0;
  const bps = measured ? moveBps(market.referencePrice, market.settlementPrice) : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={cn("text-[13px] font-semibold", SIDE_TEXT[winner])}>
        {SIDE_META[winner].label} won
      </span>
      {measured && (
        <span className="font-mono text-[12.5px] tabular text-text-2">
          moved {fmtPct(signed, { signed: true })}, {bps > market.strikeBps ? "past" : "within"}{" "}
          {fmtBps(market.strikeBps)}
        </span>
      )}
      <span className="font-mono text-[12px] tabular text-text-3">
        paid {fmtMultiple(payoutMultiple(market, winner))}
      </span>
    </div>
  );
}

function Clock({ market, phase }: { market: MarketView; phase: MarketPhase }) {
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
      return <span>Settled {fmtEtTime(market.settleTs)} ET</span>;
    case "voided":
      return <span className="text-loss">Voided</span>;
  }
}

function Row({
  market,
  now,
  feed,
}: {
  market: MarketView;
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const phase = phaseOf(market, now);
  const meta = PHASE_META[phase];
  const live = phase === "live" || phase === "awaiting-settle";
  const resolved = phase === "settled" || phase === "voided" || phase === "expired";
  const open = phase === "deposits" || phase === "awaiting-lock";

  return (
    <Link
      href={`/market/${market.key}`}
      className={cn(
        "group relative grid grid-cols-1 gap-3 px-4 py-4 transition-colors hover:bg-white/[0.035]",
        "lg:h-[64px] lg:items-center lg:gap-4 lg:py-0",
        COLUMNS,
        live && "bg-below/[0.05]",
      )}
    >
      {/* A left edge that marks the hour being measured. */}
      {live && <span className="absolute inset-y-0 left-0 w-[2px] bg-below" aria-hidden />}

      <div className="flex items-center justify-between gap-3 lg:block">
        <span className="font-mono text-[14px] font-semibold tabular text-text-1">
          {fmtEtTime(market.lockTs)}
          <span className="font-medium text-text-4"> to </span>
          {fmtEtTime(market.settleTs)}
        </span>
        <span className="lg:hidden">
          <Badge tone={meta.tone} size="sm" dot={live} pulse={phase === "live"}>
            {meta.label}
          </Badge>
        </span>
      </div>

      <div className="hidden lg:block">
        <Badge tone={meta.tone} size="sm" dot={live} pulse={phase === "live"}>
          {meta.label}
        </Badge>
      </div>

      {open && (
        <>
          <div className="hidden lg:block">
            <SideCell market={market} side="above" />
          </div>
          <div className="hidden lg:block">
            <SideCell market={market} side="below" />
          </div>
          <div className="lg:hidden">
            <SideSplit market={market} size="sm" amounts={false} />
          </div>
        </>
      )}
      {live && (
        <div className="lg:col-span-2">
          <Standing market={market} feed={feed} />
        </div>
      )}
      {resolved && (
        <div className="lg:col-span-2">
          {phase === "settled" ? (
            <Outcome market={market} />
          ) : phase === "expired" ? (
            <span className="text-[13px] text-loss">
              Missed its moment. Deposits refund in full.
            </span>
          ) : (
            <span className="text-[13px] text-loss">Never settled. Deposits refund in full.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 font-mono text-[12px] tabular text-text-3 lg:contents">
        <span>
          <span className="lg:hidden">Pot </span>
          <span className="text-text-1">{fmtUsdx(pot(market), { compact: true })}</span> USDX
        </span>
        <span className="text-right lg:text-left">
          <Clock market={market} phase={phase} />
        </span>
        <ChevronRight
          size={15}
          className="hidden text-text-4 transition-colors group-hover:text-text-1 lg:block"
        />
      </div>
    </Link>
  );
}

export default function HourlySession({
  group,
  now,
  feed,
}: {
  group: MarketGroup;
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const lead = group.markets[0];
  const live = group.markets.filter((m) => {
    const p = phaseOf(m, now);
    return p === "live" || p === "awaiting-settle";
  }).length;
  const summary = groupSummary(group, now);
  const total = group.markets.reduce((sum, m) => sum + pot(m), 0n);

  // Every hour shares the day's threshold but records its own reference at
  // its own lock, so the only honest way to put the group in dollars is
  // against the live price, said as a distance rather than as two strikes.
  const perHour =
    feed && feed.price > 0n ? strikeDistance(feed.price, lead.strikeBps) : null;

  // The soonest thing this session does next, so the header carries a clock
  // even though its rows are in different states.
  const nextMoment = (() => {
    let best: { ts: number; kind: "lock" | "settle" } | null = null;
    for (const m of group.markets) {
      const phase = phaseOf(m, now);
      const ts = phase === "deposits" ? m.lockTs : phase === "live" ? m.settleTs : null;
      const kind = phase === "deposits" ? ("lock" as const) : ("settle" as const);
      if (ts === null || ts <= now) continue;
      if (!best || ts < best.ts) best = { ts, kind };
    }
    return best;
  })();

  return (
    <section className="animate-fade-up">
      <GroupHeader
        symbol={group.symbol}
        kind="Hourly"
        feed={feed}
        now={now}
        pot={total}
        badge={
          live > 0 ? (
            <Badge size="sm" tone="sky" dot pulse>
              {live} live
            </Badge>
          ) : undefined
        }
        description={
          <>
            {fmtEtDayLong(group.lockTs)}. Will {group.symbol} move more than{" "}
            <span className="font-mono font-semibold tabular text-text-1">
              {fmtBps(lead.strikeBps)}
            </span>{" "}
            within the hour?{" "}
            {perHour !== null && (
              <>
                That is{" "}
                <span className="font-mono font-semibold tabular text-text-1">
                  {fmtDistance(perHour)}
                </span>{" "}
                either way from wherever it locks.{" "}
              </>
            )}
            It did in {samplesCleared(lead)} of the last {lead.samplesBps.length} hours.
          </>
        }
        trailing={
          <>
            <span>
              {summary.map((part, i) => (
                <span key={part.label}>
                  {i > 0 && <span className="text-text-4"> · </span>}
                  <span className="text-text-1">{part.n}</span> {part.label}
                </span>
              ))}
            </span>
            {nextMoment && (
              <span>
                {nextMoment.kind === "lock" ? "Next lock in " : "Settles in "}
                <Countdown to={nextMoment.ts} className="text-text-1" />
              </span>
            )}
          </>
        }
      />

      <div className="overflow-hidden rounded-lg border border-line-2 bg-surface-2">
        <div
          className={cn(
            "hidden border-b border-line-1 bg-white/[0.015] px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-3 lg:grid lg:gap-4",
            COLUMNS,
          )}
        >
          <span>Hour, ET</span>
          <span>Status</span>
          <span>Yes, moves more</span>
          <span>No, stays within</span>
          <span>Pot</span>
          <span>Time</span>
          <span />
        </div>
        <div className="divide-y divide-line-1">
          {group.markets.map((m) => (
            <Row key={m.key} market={m} now={now} feed={feed} />
          ))}
        </div>
      </div>
    </section>
  );
}
