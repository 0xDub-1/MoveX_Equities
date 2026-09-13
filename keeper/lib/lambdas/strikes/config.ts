// =============================================================================
// Strike calibration config
// =============================================================================
//
// Every number the strike ladder depends on lives here. Nothing downstream
// hardcodes a threshold, a percentile or a lookback.

/**
 * How many completed sessions the ladder is calibrated on.
 *
 * 20 is roughly one trading month. Short enough that the ladder tracks the
 * current volatility regime, long enough that a single violent session
 * cannot own the distribution.
 */
export const LOOKBACK_SESSIONS = 20;

export type Rung = "tight" | "fair" | "wide";

export const ALL_RUNGS: readonly Rung[] = ["tight", "fair", "wide"];

/**
 * Each rung is a percentile of the trailing move distribution, which is
 * what makes its base rate true by construction rather than by assertion:
 * P25 means exactly 25% of the last 20 sessions moved more than that.
 *
 * This is the whole reason the threshold is defensible. Nobody picks it,
 * and the 20 numbers it came from ship to the UI alongside it.
 */
export const RUNG_PERCENTILES: Record<Rung, number> = {
  tight: 0.25,
  fair: 0.5,
  wide: 0.75,
};

export interface TickerConfig {
  readonly symbol: string;
  /**
   * Which rungs get a live market. Strikes are computed for all three
   * regardless, because the cost is zero and the full ladder is useful
   * context even where we only list one rung.
   */
  readonly rungs: readonly Rung[];
}

/**
 * Seeding plan from the roadmap: NVDA carries the full three-rung ladder,
 * TSLA and SPY list FAIR only so liquidity is not spread across nine
 * markets on day one.
 */
export const TICKERS: readonly TickerConfig[] = [
  { symbol: "NVDA", rungs: ["tight", "fair", "wide"] },
  { symbol: "TSLA", rungs: ["fair"] },
  { symbol: "SPY", rungs: ["fair"] },
];
