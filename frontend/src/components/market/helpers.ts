// =============================================================================
// Market page helpers
// =============================================================================
//
// Copy and grouping shared by the panels of one market page. Pure functions
// over MarketView, so every panel says the same thing about the same market.

import { ET, fmtEtDateTime, fmtEtDay, fmtEtDayLong, fmtEtTime } from "@/lib/calendar";
import { QUOTE_DECIMALS, TICKER_NAMES, type Ticker } from "@/lib/config";
import { fmtBps } from "@/lib/format";
import { TIER_ORDER, ladderId, type MarketView, type Tier } from "@/lib/market";

export function companyName(symbol: string): string | undefined {
  return symbol in TICKER_NAMES ? TICKER_NAMES[symbol as Ticker] : undefined;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "long" });

/** `Tuesday`, in New York. */
export function etWeekday(tsSec: number): string {
  return WEEKDAY.format(new Date(tsSec * 1000));
}

/** The market's question in plain words. */
export function questionOf(m: MarketView): string {
  const head = `Will ${m.symbol} move more than ${fmtBps(m.strikeBps)}`;
  if (m.kind === "daily") {
    return `${head} between ${etWeekday(m.lockTs)}'s close and ${etWeekday(m.settleTs)}'s close?`;
  }
  return `${head} between ${fmtEtTime(m.lockTs)} and ${fmtEtTime(m.settleTs)} ET?`;
}

/** The lock and settle window, in New York time. */
export function windowOf(m: MarketView): string {
  if (m.kind === "daily") {
    return `Locks ${fmtEtDateTime(m.lockTs)} · Settles ${fmtEtDateTime(m.settleTs)}`;
  }
  return `${fmtEtDayLong(m.lockTs)} · ${fmtEtTime(m.lockTs)} to ${fmtEtTime(m.settleTs)} ET`;
}

function byTier(a: MarketView, b: MarketView): number {
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
}

/**
 * The rungs of the same ladder (same ticker, same session), this market
 * included, tightest first. What the gauge and the histogram draw as ticks.
 */
export function ladderRungs(market: MarketView, all: MarketView[] | undefined): MarketView[] {
  if (!all) return [];
  const id = ladderId(market);
  return all.filter((m) => ladderId(m) === id).sort(byTier);
}

/**
 * What the ladder section lists: the rungs for a daily market, and for an
 * hourly one every slot of the same ticker on the same New York day.
 */
export function siblingsOf(market: MarketView, all: MarketView[] | undefined): MarketView[] {
  if (!all) return [];
  if (market.kind === "daily") return ladderRungs(market, all);
  const day = fmtEtDay(market.lockTs);
  return all
    .filter((m) => m.symbol === market.symbol && m.kind === "hourly" && fmtEtDay(m.lockTs) === day)
    .sort((a, b) => a.lockTs - b.lockTs || byTier(a, b));
}

export const PERCENTILE_ORDINAL: Record<Tier, string> = {
  tight: "25th",
  fair: "50th",
  wide: "75th",
};

/** `1%` for 100 bps, `0.5%` for 50. */
export function feeLabel(feeBps: number): string {
  return `${feeBps / 100}%`;
}

/** Base units as the plain decimal string an input holds, no separators. */
export function baseToInput(base: bigint): string {
  const unit = 10n ** BigInt(QUOTE_DECIMALS);
  const whole = base / unit;
  const frac = (base % unit).toString().padStart(QUOTE_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
