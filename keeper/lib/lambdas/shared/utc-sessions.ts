// =============================================================================
// UTC sessions for the crypto venue
// =============================================================================
//
// Crypto has no calendar. An hourly market locks on the hour and settles on
// the next; a daily one locks at midnight UTC and settles at the midnight
// after. Everything here is pure arithmetic on unix seconds, so it can be
// tested without a clock and never has a daylight-saving edge.
//
// Identifiers are what the program stores in `session_date`, ten bytes at
// most. Nine characters mean hourly and ten mean daily, a convention the
// crank and the frontend already read, so the crypto ids keep it:
//
//   260921-18    the hour locking at 2026-09-21 18:00 UTC
//   2026-09-22   the day locking at 2026-09-22 00:00 UTC
//
// The year is in the hourly id on purpose. The equities form `0921-1800`
// would collide with itself twelve months later, because a market's address
// is derived from its id and the account never goes away.

import {
  CRYPTO_ASSETS,
  CRYPTO_DAILY_LEAD_HOURS,
  CRYPTO_DAILY_LOOKAHEAD_DAYS,
  CRYPTO_DAILY_LOOKBACK_DAYS,
  CRYPTO_HOURLY_LEAD_HOURS,
  CRYPTO_HOURLY_LOOKBACK_HOURS,
  CRYPTO_HOURLY_TIER,
} from "./crypto-config";
import type { Ladder } from "./hyperliquid";
import type { MarketSpec, Tier } from "./markets";

export const HOUR_SECS = 3_600;
export const DAY_SECS = 86_400;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYY-MM-DD` in UTC. */
export function utcDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYMMDD-HH` for the hour that locks at `lockTs`, which must be a whole hour. */
export function hourlyId(lockTs: number): string {
  if (lockTs % HOUR_SECS !== 0) throw new Error(`${lockTs} is not on the hour`);
  const d = new Date(lockTs * 1000);
  return `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}`;
}

/** The lock time an hourly id names. */
export function hourlyLockTs(id: string): number {
  const m = /^(\d{2})(\d{2})(\d{2})-(\d{2})$/.exec(id);
  if (!m) throw new Error(`${id} is not an hourly id`);
  const [, yy, mm, dd, hh] = m;
  return Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh)) / 1000;
}

/** `YYYY-MM-DD` of the day a daily market measures: it locks at that day's midnight. */
export function dailyId(lockTs: number): string {
  if (lockTs % DAY_SECS !== 0) throw new Error(`${lockTs} is not midnight UTC`);
  return utcDate(lockTs);
}

export function dailyLockTs(id: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) throw new Error(`${id} is not a daily id`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
}

export function isHourlyId(id: string): boolean {
  return id.length === 9;
}

export interface UtcSlot {
  sessionId: string;
  lockTs: number;
  settleTs: number;
}

/**
 * The hourly slots that should exist right now: every whole hour strictly
 * after `nowSec` and within the lead. At 14:05 with a lead of four that is
 * 15:00, 16:00, 17:00 and 18:00; the 14:00 hour was created at 10:05.
 */
export function hourlySlotsAhead(nowSec: number, leadHours = CRYPTO_HOURLY_LEAD_HOURS): UtcSlot[] {
  const first = Math.floor(nowSec / HOUR_SECS) * HOUR_SECS + HOUR_SECS;
  const slots: UtcSlot[] = [];
  for (let k = 0; k < leadHours; k++) {
    const lockTs = first + k * HOUR_SECS;
    slots.push({ sessionId: hourlyId(lockTs), lockTs, settleTs: lockTs + HOUR_SECS });
  }
  return slots;
}

/**
 * The daily slots that should exist right now: every midnight strictly after
 * `nowSec` and no more than the lead away. With a lead of 24 hours that is
 * the next midnight from a minute past the last one, so each day's ladder
 * goes up just after the previous one locks.
 */
export function dailySlotsAhead(nowSec: number, leadHours = CRYPTO_DAILY_LEAD_HOURS): UtcSlot[] {
  const slots: UtcSlot[] = [];
  const horizon = nowSec + leadHours * HOUR_SECS;
  for (let lockTs = Math.floor(nowSec / DAY_SECS) * DAY_SECS + DAY_SECS; lockTs <= horizon; lockTs += DAY_SECS) {
    slots.push({ sessionId: dailyId(lockTs), lockTs, settleTs: lockTs + DAY_SECS });
  }
  return slots;
}

export interface CryptoCandidate {
  symbol: string;
  sessionId: string;
  tier: Tier;
  kind: "daily" | "hourly";
}

/**
 * Which markets the crypto crank and seeder look at. Recent enough to catch
 * anything a missed tick left unsettled or unclaimed, far enough ahead to
 * fund what the markets lambda just created.
 */
export function cryptoCandidates(nowSec: number): CryptoCandidate[] {
  const out: CryptoCandidate[] = [];

  const firstHour = Math.floor(nowSec / HOUR_SECS) * HOUR_SECS - CRYPTO_HOURLY_LOOKBACK_HOURS * HOUR_SECS;
  const lastHour = Math.floor(nowSec / HOUR_SECS) * HOUR_SECS + CRYPTO_HOURLY_LEAD_HOURS * HOUR_SECS;
  for (const asset of CRYPTO_ASSETS) {
    if (!asset.hourly) continue;
    for (let lockTs = firstHour; lockTs <= lastHour; lockTs += HOUR_SECS) {
      out.push({ symbol: asset.symbol, sessionId: hourlyId(lockTs), tier: CRYPTO_HOURLY_TIER, kind: "hourly" });
    }
  }

  const today = Math.floor(nowSec / DAY_SECS) * DAY_SECS;
  for (let d = -CRYPTO_DAILY_LOOKBACK_DAYS; d <= CRYPTO_DAILY_LOOKAHEAD_DAYS; d++) {
    const sessionId = dailyId(today + d * DAY_SECS);
    for (const asset of CRYPTO_ASSETS) {
      for (const tier of asset.dailyRungs) {
        out.push({ symbol: asset.symbol, sessionId, tier, kind: "daily" });
      }
    }
  }

  return out;
}

export function hourlySpec(symbol: string, slot: UtcSlot, ladder: Ladder): MarketSpec {
  return {
    symbol,
    sessionId: slot.sessionId,
    tier: CRYPTO_HOURLY_TIER,
    strikeBps: ladder.strikeBps,
    samplesBps: ladder.samplesBps,
    lockTs: slot.lockTs,
    settleTs: slot.settleTs,
    kind: "hourly",
  };
}

export function dailySpec(symbol: string, slot: UtcSlot, tier: Tier, ladder: Ladder): MarketSpec {
  return {
    symbol,
    sessionId: slot.sessionId,
    tier,
    strikeBps: ladder.strikes[tier],
    samplesBps: ladder.samplesBps,
    lockTs: slot.lockTs,
    settleTs: slot.settleTs,
    kind: "daily",
  };
}
