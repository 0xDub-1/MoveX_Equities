// =============================================================================
// Strike ladder
// =============================================================================
//
// The percentile maths, isolated and pure so it can be tested against
// hand-computed numbers without touching the network.

import { RUNG_PERCENTILES, type Rung } from "./config";

/**
 * Linear-interpolated percentile over an ascending array.
 *
 * Interpolating rather than picking a nearest element matters at n=20:
 * P50 lands between the 10th and 11th values, and rounding to one of them
 * would bias the "coin flip" rung to one side of the distribution.
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) {
    throw new Error("percentile of an empty series");
  }
  if (p < 0 || p > 1) {
    throw new Error(`percentile p must be in [0, 1], got ${p}`);
  }

  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);

  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (idx - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

/**
 * The three thresholds, read straight out of the ticker's own recent
 * behaviour. No model, no forecast, no tuning: sort the last 20 absolute
 * moves and read off the quarter, half and three-quarter marks.
 *
 * The median is what makes this robust. One violent session lands at the
 * right edge of the sorted list and cannot drag the middle around, where an
 * average would have been pulled with it.
 */
export function computeLadder(movesPct: readonly number[]): Record<Rung, number> {
  const sorted = [...movesPct].sort((a, b) => a - b);

  return {
    tight: round2(percentile(sorted, RUNG_PERCENTILES.tight)),
    fair: round2(percentile(sorted, RUNG_PERCENTILES.fair)),
    wide: round2(percentile(sorted, RUNG_PERCENTILES.wide)),
  };
}

/**
 * Percent to basis points, which is how the on-chain program stores a
 * threshold. Integers only: comparing a settled move against a float
 * strike on-chain would be a rounding argument waiting to happen.
 */
export function toBps(pct: number): number {
  return Math.round(pct * 100);
}

/** Two decimal places, which is the precision a threshold is quoted at. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
