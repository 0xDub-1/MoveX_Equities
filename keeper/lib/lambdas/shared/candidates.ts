// =============================================================================
// Crank candidates
// =============================================================================
//
// Which markets the crank should look at on a given date. Pure: calendar and
// config in, a list of (ticker, session, tier) out. No RPC, no Anchor.
//
// Kept apart from the crank handler so it can be unit tested without the
// Solana client in the module graph, and so the lookup rule is readable on
// its own.

import { hourlySlots, nextTradingDay } from "./calendar";
import { HOURLY_TICKER, PUBLISHED_TICKERS } from "./config";
import { TICKERS } from "../strikes/config";
import type { Tier } from "./markets";

// One source of truth for which rungs each ticker lists: the strike config.
const DAILY_RUNGS: Record<string, Tier[]> = Object.fromEntries(
  TICKERS.map((t) => [t.symbol, [...t.rungs] as Tier[]]),
);

/** How many past sessions to look back for markets still needing a crank. */
const LOOKBACK_DAYS = 4;

export interface Candidate {
  symbol: string;
  sessionId: string;
  tier: Tier;
}

export function candidates(today: string): Candidate[] {
  const out: Candidate[] = [];

  // Hourly slots for today and for the next session. The next session's
  // markets are created at 15:55 the evening before, so the seeder has to
  // see them that same hour rather than waiting until the morning, which is
  // the whole point of creating them early.
  const hourlyDates = [today];
  try {
    hourlyDates.push(nextTradingDay(today));
  } catch {
    // Calendar does not cover the year ahead.
  }
  for (const date of hourlyDates) {
    try {
      for (const slot of hourlySlots(date)) {
        out.push({ symbol: HOURLY_TICKER, sessionId: slot.sessionId, tier: "fair" });
      }
    } catch {
      // Not a trading day, so no hourly slots there. Daily markets from
      // previous sessions may still need settling, so this is not fatal.
    }
  }

  // Daily markets are keyed by the date they settle. The one that locks at
  // today's close therefore carries the NEXT session's date, so the scan has
  // to start one trading day ahead and walk backward. Starting at today would
  // never find a daily market on the day it needs locking, and it would sit
  // in Open until it voided six hours later.
  // Two sessions ahead, not one: a daily market created at 15:55 today is
  // keyed by the session after next, and the seeder funds it the same hour.
  const dates: string[] = [];
  try {
    const next = nextTradingDay(today);
    dates.push(nextTradingDay(next), next);
  } catch {
    // Calendar does not cover the year ahead. Past markets can still settle.
  }
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  for (const date of dates) {
    for (const symbol of PUBLISHED_TICKERS) {
      for (const tier of DAILY_RUNGS[symbol] ?? ["fair"]) {
        out.push({ symbol, sessionId: date, tier });
      }
    }
  }

  return out;
}
