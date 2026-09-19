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

// -- live round ---------------------------------------------------------------
//
// Deposits after lock, under a cap that decays from LIVE_MAX_MULTIPLE_BPS
// just after lock to the deposit less the fee at settlement. All four are
// frozen into each market at creation, so changing them here changes the
// next market and never a running one.

/** Whether markets accept deposits after lock. The switch for the round. */
export const LIVE_DEPOSITS = true;

/**
 * The most a live deposit may be paid, in basis points of itself, for one
 * landing the instant the market locks. Program ceiling is 50_000.
 */
export const LIVE_MAX_MULTIPLE_BPS = 20_000;

/**
 * How fast that maximum decays across the window, by kind of market.
 *
 * A daily market carries the overnight gap, which can decide it with a
 * quarter of the window still to run, so its cap decays faster. Program
 * ceiling is 3.
 */
export const LIVE_CAP_EXP: Record<"daily" | "hourly", number> = { daily: 3, hourly: 2 };

/** How often the publisher writes a price. */
export const PUBLISH_INTERVAL_SECS = 60;

/**
 * Live deposits close this long before settlement.
 *
 * The settle print is the last feed write before `settle_ts`, so a deposit
 * placed closer than one publish interval could be placed knowing it. Two
 * intervals leaves room for a late write. Program floor is 60.
 */
export const LIVE_CUTOFF_SECS = 2 * PUBLISH_INTERVAL_SECS;

// The one relationship between these numbers that has to hold. Checked at
// load rather than trusted, because the cutoff is what stands between the
// live round and a deposit that already knows the settle print.
if (LIVE_CUTOFF_SECS < 2 * PUBLISH_INTERVAL_SECS) {
  throw new Error(
    `LIVE_CUTOFF_SECS (${LIVE_CUTOFF_SECS}) must be at least twice PUBLISH_INTERVAL_SECS (${PUBLISH_INTERVAL_SECS})`,
  );
}

/**
 * How late a crank may still act.
 *
 * A lock or settle that missed its moment by a few minutes is better done
 * late than not at all, since the alternative is the market voiding six
 * hours later. Beyond this the price has moved far enough from the intended
 * instant that voiding is the honest outcome.
 */
export const CRANK_GRACE_MINUTES = 20;

/**
 * Matches `VOID_GRACE_SECS` in the program's constants.rs.
 *
 * Past this much time beyond its settle time a market can no longer resolve
 * and the program lets anyone void it, refunding every deposit in full. The
 * program enforces the bound; this copy only decides when the crank bothers
 * to ask.
 */
export const VOID_GRACE_SECS = 6 * 60 * 60;
