"use client";

// =============================================================================
// Session timeline
// =============================================================================
//
// The whole trading day on one line, so nobody has to read the board to know
// when the next thing happens. Each intraday market is a segment between its
// lock and its settle, the past is coloured by which answer won, the hour
// being measured is bright, and a needle marks now.
//
// Above it, the single next moment anything changes state, in words.

import { useMemo } from "react";
import Link from "next/link";

import {
  OPEN_MINUTES,
  closeMinutes,
  easternTimestamp,
  etDate,
  fmtEtDay,
  fmtEtTime,
  nextPostTs,
} from "@/lib/calendar";
import { fmtBps } from "@/lib/format";
import { SIDE_META, isResolved, phaseOf, type MarketView } from "@/lib/market";
import { nextEvent } from "@/lib/upcoming";
import { cn } from "@/lib/utils";

import { Countdown, Eyebrow, Skeleton } from "@/components/ui/primitives";

const REGULAR_CLOSE_MINUTES = 16 * 60;

interface Segment {
  market: MarketView;
  left: number;
  width: number;
  state: "open" | "live" | "settled";
  title: string;
}

function segmentClass(seg: Segment): string {
  if (seg.state === "live") {
    return "bg-white/35 ring-1 ring-inset ring-white/60 animate-pulse-soft";
  }
  if (seg.state === "settled") {
    const winner = seg.market.winningSide;
    if (winner === "above") return "bg-above/40";
    if (winner === "below") return "bg-below/40";
    return "bg-white/12";
  }
  return "bg-white/[0.09] hover:bg-white/[0.16]";
}

/** The day the timeline should show, and its intraday markets. */
function pickDay(hourly: MarketView[]): { day: string; markets: MarketView[] } | null {
  if (hourly.length === 0) return null;

  const byDay = new Map<string, MarketView[]>();
  for (const m of hourly) {
    const day = etDate(new Date(m.lockTs * 1000));
    const list = byDay.get(day);
    if (list) list.push(m);
    else byDay.set(day, [m]);
  }

  const days = [...byDay.keys()].sort();
  // The earliest day that still has something to come, so a session in
  // progress wins over one already finished.
  const day =
    days.find((d) => byDay.get(d)!.some((m) => !isResolved(m))) ?? days[days.length - 1];
  return { day, markets: byDay.get(day)!.sort((a, b) => a.lockTs - b.lockTs) };
}

function Empty({ now }: { now: number }) {
  const postTs = useMemo(() => {
    try {
      return nextPostTs(new Date(now * 1000));
    } catch {
      // The calendar does not cover the year ahead.
      return null;
    }
  }, [now]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-line-2 bg-surface-1/70 px-4 py-6 text-center">
      <p className="text-[13.5px] font-medium text-text-1">No intraday markets on the board</p>
      {postTs ? (
        <p className="text-[12.5px] text-text-2">
          The next session&apos;s hours post at 15:55 ET, in{" "}
          <span className="font-mono tabular text-brand">
            <Countdown to={postTs} />
          </span>
          , alongside the daily ladder.
        </p>
      ) : (
        <p className="text-[12.5px] text-text-2">
          Intraday markets post at 15:55 ET for the following session.
        </p>
      )}
    </div>
  );
}

export default function SessionTimeline({
  markets,
  now,
}: {
  markets: MarketView[];
  now: number;
}) {
  const hourly = useMemo(() => markets.filter((m) => m.kind === "hourly"), [markets]);
  const picked = useMemo(() => pickDay(hourly), [hourly]);
  const upcoming = useMemo(() => nextEvent(markets, now), [markets, now]);

  const model = useMemo(() => {
    if (!picked || !now) return null;
    const { day, markets: dayMarkets } = picked;

    let close = REGULAR_CLOSE_MINUTES;
    try {
      close = closeMinutes(day);
    } catch {
      // Not a session by our calendar. The markets exist, so draw a normal day.
    }

    const startTs = easternTimestamp(day, OPEN_MINUTES);
    const closeTs = easternTimestamp(day, close);
    const span = Math.max(1, closeTs - startTs);
    const pct = (ts: number) => ((ts - startTs) / span) * 100;

    const segments: Segment[] = dayMarkets.map((m) => {
      const phase = phaseOf(m, now);
      const state: Segment["state"] =
        phase === "settled" || phase === "voided"
          ? "settled"
          : phase === "live" || phase === "awaiting-settle"
            ? "live"
            : "open";
      const window = `${fmtEtTime(m.lockTs)} to ${fmtEtTime(m.settleTs)} ET`;
      const outcome =
        state === "settled" && m.winningSide
          ? `${SIDE_META[m.winningSide].label} won`
          : state === "live"
            ? "being measured now"
            : "open for deposits";
      return {
        market: m,
        left: pct(m.lockTs),
        width: Math.max(2, pct(m.settleTs) - pct(m.lockTs)),
        state,
        title: `${window}, more than ${fmtBps(m.strikeBps)}, ${outcome}`,
      };
    });

    const hours: { minutes: number; x: number }[] = [];
    for (let h = Math.ceil(OPEN_MINUTES / 60); h * 60 <= close; h++) {
      hours.push({ minutes: h * 60, x: pct(easternTimestamp(day, h * 60)) });
    }

    const inSession = now >= startTs && now <= closeTs;
    return { day, segments, hours, nowX: inSession ? pct(now) : null, startTs, closeTs, close };
  }, [picked, now]);

  if (!now) return <Skeleton className="h-[112px]" />;
  if (!model) return <Empty now={now} />;

  const before = now < model.startTs;

  return (
    <section className="rounded-lg border border-line-2 bg-surface-1/70 px-4 py-3.5 sm:px-5">
      {/* What happens next, in words */}
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <Eyebrow size="sm">Next</Eyebrow>
          {upcoming ? (
            <p className="min-w-0 text-[13.5px] text-text-2">
              {upcoming.href ? (
                <Link href={upcoming.href} className="font-medium text-text-1 hover:text-brand">
                  {upcoming.label}
                </Link>
              ) : (
                <span className="font-medium text-text-1">{upcoming.label}</span>
              )}{" "}
              {upcoming.kind === "lock" ? "locks in" : "settles in"}{" "}
              <span className="font-mono tabular text-text-1">
                <Countdown to={upcoming.ts} />
              </span>
            </p>
          ) : (
            <p className="text-[13.5px] text-text-3">Nothing scheduled</p>
          )}
        </div>
        <p className="shrink-0 font-mono text-[12px] tabular text-text-3">
          {fmtEtDay(model.startTs)}
          <span className="text-text-4"> · </span>
          {before ? "opens" : "closes"}{" "}
          {before ? fmtEtTime(model.startTs) : fmtEtTime(model.closeTs)} ET
        </p>
      </div>

      {/* The day */}
      <div className="relative h-7">
        <div className="absolute inset-0 overflow-hidden rounded-md bg-white/[0.03]" />

        {/* Hour ticks, behind the segments */}
        {model.hours.map((h) => (
          <div
            key={h.minutes}
            className="absolute inset-y-0 w-px bg-white/[0.07]"
            style={{ left: `${h.x}%` }}
            aria-hidden
          />
        ))}

        {model.segments.map((seg) => (
          <Link
            key={seg.market.key}
            href={`/market/${seg.market.key}`}
            title={seg.title}
            aria-label={seg.title}
            className={cn(
              "absolute inset-y-1 rounded-sm transition-colors",
              segmentClass(seg),
            )}
            style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
          />
        ))}

        {/* Now */}
        {model.nowX !== null && (
          <div
            className="absolute -inset-y-1 z-10 w-[2px] rounded-full bg-brand"
            style={{ left: `${model.nowX}%` }}
          >
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand" />
          </div>
        )}
      </div>

      {/* Hour labels */}
      <div className="relative mt-1.5 h-4">
        {model.hours.map((h, i) => (
          <span
            key={h.minutes}
            className={cn(
              "absolute -translate-x-1/2 font-mono text-[11px] tabular text-text-4",
              // The first and last sit inside the track rather than over its edge.
              i === 0 && "translate-x-0",
              i === model.hours.length - 1 && "-translate-x-full",
            )}
            style={{ left: `${h.x}%` }}
          >
            {String(Math.floor(h.minutes / 60)).padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </section>
  );
}
