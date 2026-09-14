// Shared keeper configuration.
//
// Values the program also knows about live here so the two cannot drift
// apart silently. Where a number appears in both, the Rust side is the
// authority and this file names where.

/** Matches `KEEPER_PRICE_EXPONENT` in the program's constants.rs. */
export const KEEPER_PRICE_EXPONENT = -8;

/** Matches `MAX_PRICE_AGE_SECS` in the program's oracle.rs. */
export const MAX_PRICE_AGE_SECS = 120;

/** Tickers the keeper publishes prices for. */
export const PUBLISHED_TICKERS = ["NVDA", "TSLA", "SPY"] as const;

/**
 * Only NVDA carries hourly markets.
 *
 * Six markets a day on one ticker keeps the intraday pools deep enough to
 * look like a venue. Spreading the same deposits across three tickers would
 * produce eighteen thin pools and absurd payout ratios.
 */
export const HOURLY_TICKER = "NVDA";

/** Minutes before a lock at which a daily market opens for deposits. */
export const DAILY_DEPOSIT_WINDOW_MINUTES = 24 * 60;

/** Protocol fee, in basis points. Ceiling in the program is 500. */
export const FEE_BPS = 100;

/**
 * How late a crank may still act.
 *
 * A lock or settle that missed its moment by a few minutes is better done
 * late than not at all, since the alternative is the market voiding six
 * hours later. Beyond this the price has moved far enough from the intended
 * instant that voiding is the honest outcome.
 */
export const CRANK_GRACE_MINUTES = 20;
