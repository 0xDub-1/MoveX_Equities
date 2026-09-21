"use client";

// =============================================================================
// Hourly countdown
// =============================================================================
//
// One line saying how long until the hourly markets do something, so that
// answer does not require reading the board. When there are none it says
// when the next ones are posted: the evening for equities, and for crypto
// simply that they come four hours ahead around the clock.

import { useMemo } from "react";
import Link from "next/link";

import { HOURLY_POST_MINUTES, fmtPostTime, nextPostTs } from "@/lib/calendar";
import type { MarketView } from "@/lib/market";
import { nextEvent } from "@/lib/upcoming";
import type { Venue } from "@/lib/venue";

import { Countdown, Eyebrow, Skeleton } from "@/components/ui/primitives";

export default function HourlyCountdown({
  markets,
  now,
  venue,
}: {
  markets: MarketView[];
  now: number;
  venue: Venue;
}) {
  const hourly = useMemo(() => markets.filter((m) => m.kind === "hourly"), [markets]);
  const upcoming = useMemo(() => nextEvent(hourly, now), [hourly, now]);

  const postTs = useMemo(() => {
    if (!now || venue !== "equities") return null;
    try {
      return nextPostTs(new Date(now * 1000), HOURLY_POST_MINUTES);
    } catch {
      // The calendar does not cover the year ahead.
      return null;
    }
  }, [now, venue]);

  if (!now) return <Skeleton className="h-11" />;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line-2 bg-surface-1/70 px-4 py-3 sm:px-5">
      <Eyebrow size="sm">Hourly</Eyebrow>
      {upcoming ? (
        <p className="text-[13.5px] text-text-2">
          {upcoming.href ? (
            <Link href={upcoming.href} className="font-medium text-text-1 hover:text-brand">
              {upcoming.label}
            </Link>
          ) : (
            <span className="font-medium text-text-1">{upcoming.label}</span>
          )}{" "}
          {upcoming.kind === "lock" ? "locks in" : "settles in"}{" "}
          <span className="font-mono text-[14px] font-semibold tabular text-text-1">
            <Countdown to={upcoming.ts} />
          </span>
        </p>
      ) : venue === "crypto" ? (
        <p className="text-[13.5px] text-text-2">
          Hourly markets are posted four hours ahead, around the clock. The next one appears within
          minutes.
        </p>
      ) : postTs ? (
        <p className="text-[13.5px] text-text-2">
          The next session&apos;s hours post at {fmtPostTime(HOURLY_POST_MINUTES)} ET, in{" "}
          <span className="font-mono text-[14px] font-semibold tabular text-brand">
            <Countdown to={postTs} />
          </span>
        </p>
      ) : (
        <p className="text-[13.5px] text-text-2">
          Intraday markets post at {fmtPostTime(HOURLY_POST_MINUTES)} ET for the following session.
        </p>
      )}
    </div>
  );
}
