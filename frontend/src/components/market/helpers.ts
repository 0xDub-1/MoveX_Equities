// =============================================================================
// Market page helpers
// =============================================================================
//
// Copy and grouping shared by the panels of one market page. Pure functions
// over MarketView, so every panel says the same thing about the same market,
// in the clock of the venue the market trades on.

import { assetName, venueOfSymbol } from "@/lib/assets";
import { fmtDateTime, fmtDay, fmtDayLong, fmtTime, fmtWeekday } from "@/lib/clock";
import { QUOTE_DECIMALS } from "@/lib/config";
import { fmtBps } from "@/lib/format";
import { TIER_ORDER, ladderId, type MarketView, type Tier } from "@/lib/market";
import { VENUES } from "@/lib/venue";

export function companyName(symbol: string): string | undefined {
  return assetName(symbol);
}

/** The market's question in plain words. */
export function questionOf(m: MarketView): string {
  const venue = venueOfSymbol(m.symbol);
  const tz = VENUES[venue].tz;
  const head = `Will ${m.symbol} move more than ${fmtBps(m.strikeBps)}`;
  if (m.kind === "daily") {
    if (venue === "crypto") {
      return `${head} from midnight ${fmtWeekday(m.lockTs, venue)} to midnight ${fmtWeekday(m.settleTs, venue)}, UTC?`;
    }
    return `${head} between ${fmtWeekday(m.lockTs, venue)}'s close and ${fmtWeekday(m.settleTs, venue)}'s close?`;
  }
  return `${head} between ${fmtTime(m.lockTs, venue)} and ${fmtTime(m.settleTs, venue)} ${tz}?`;
}

/** The lock and settle window, in the venue's time. */
export function windowOf(m: MarketView): string {
  const venue = venueOfSymbol(m.symbol);
  if (m.kind === "daily") {
    return `Locks ${fmtDateTime(m.lockTs, venue)} · Settles ${fmtDateTime(m.settleTs, venue)}`;
  }
  return `${fmtDayLong(m.lockTs, venue)} · ${fmtTime(m.lockTs, venue)} to ${fmtTime(m.settleTs, venue)} ${VENUES[venue].tz}`;
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
 * hourly one every slot of the same ticker on the same day, where a day is
 * the venue's day.
 */
export function siblingsOf(market: MarketView, all: MarketView[] | undefined): MarketView[] {
  if (!all) return [];
  if (market.kind === "daily") return ladderRungs(market, all);
  const venue = venueOfSymbol(market.symbol);
  const day = fmtDay(market.lockTs, venue);
  return all
    .filter((m) => m.symbol === market.symbol && m.kind === "hourly" && fmtDay(m.lockTs, venue) === day)
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
