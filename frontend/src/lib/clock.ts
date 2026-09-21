// =============================================================================
// Clocks, by venue
// =============================================================================
//
// Every time on screen is written in the venue's zone: New York for
// equities, UTC for crypto. These formatters take the venue rather than a
// zone so a component can never pick the wrong one for a market. Pure and
// DST-safe: offsets come from Intl at the instant in question.

import { HOUR_SECS } from "./sessions";
import { VENUES, type Venue } from "./venue";

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(venue: Venue, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${venue}:${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: VENUES[venue].timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

/** `16:00`, in the venue's zone. */
export function fmtTime(tsSec: number, venue: Venue): string {
  return formatter(venue, { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(tsSec * 1000))
    .replace(/^24/, "00");
}

/** `16:00:07`, for the header clock. */
export function fmtClock(at: Date, venue: Venue): string {
  return formatter(venue, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .format(at)
    .replace(/^24/, "00");
}

/** `Mon, Sep 14`. */
export function fmtDay(tsSec: number, venue: Venue): string {
  return formatter(venue, { weekday: "short", month: "short", day: "numeric" }).format(new Date(tsSec * 1000));
}

/** `Monday, September 14`. */
export function fmtDayLong(tsSec: number, venue: Venue): string {
  return formatter(venue, { weekday: "long", month: "long", day: "numeric" }).format(new Date(tsSec * 1000));
}

/** `Monday`. */
export function fmtWeekday(tsSec: number, venue: Venue): string {
  return formatter(venue, { weekday: "long" }).format(new Date(tsSec * 1000));
}

/** `Mon, Sep 14 · 16:00 ET`. */
export function fmtDateTime(tsSec: number, venue: Venue): string {
  return `${fmtDay(tsSec, venue)} · ${fmtTime(tsSec, venue)} ${VENUES[venue].tz}`;
}

/** `16:00 ET`. */
export function fmtTimeTz(tsSec: number, venue: Venue): string {
  return `${fmtTime(tsSec, venue)} ${VENUES[venue].tz}`;
}

/** `YYYY-MM-DD` in the venue's zone. */
export function dateOf(tsSec: number, venue: Venue): string {
  const parts = formatter(venue, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(tsSec * 1000),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface VenueStatus {
  /** Whether markets are being measured right now. */
  open: boolean;
  label: string;
  /** What happens next and when, for the header clock. */
  nextLabel: string;
  nextTs: number;
}

/**
 * Where the crypto venue is right now. It never closes, so the answer is
 * always the same shape: open, and the next hour locks at the top of it.
 */
export function cryptoStatus(at: Date): VenueStatus {
  const nowSec = Math.floor(at.getTime() / 1000);
  const nextHour = Math.floor(nowSec / HOUR_SECS) * HOUR_SECS + HOUR_SECS;
  return {
    open: true,
    label: "Open 24/7",
    nextLabel: `Next hour locks at ${fmtTime(nextHour, "crypto")} UTC`,
    nextTs: nextHour,
  };
}
