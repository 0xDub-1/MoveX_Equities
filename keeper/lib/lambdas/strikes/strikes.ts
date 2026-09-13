// =============================================================================
// Strike ladder
// =============================================================================
//
// Basis points are the canonical representation, and the only one the maths
// runs on. Percent is a display projection derived from bps, never the other
// way round.
//
// This is deliberate. The on-chain program recomputes the same percentile
// from the same integer samples and rejects a market whose strike does not
// match. If this file computed in floating point and rounded at the end, the
// two could disagree by a basis point and a perfectly correct market would be
// refused. One definition, expressed identically in both languages.
//
// The Rust side lives in program/programs/movex-equities/src/strike.rs and
// carries the same weights table.

import { type Rung } from "./config";

/**
 * Interpolation weights for each rung over a 20-element sorted series.
 *
 * A percentile at `idx = p * (n - 1)` sits between `s[lo]` and `s[lo + 1]`:
 *
 *   value = s[lo] * (1 - frac) + s[lo + 1] * frac
 *
 *   P25 -> idx = 0.25 * 19 =  4.75  -> lo =  4, frac = 0.75
 *   P50 -> idx = 0.50 * 19 =  9.50  -> lo =  9, frac = 0.50
 *   P75 -> idx = 0.75 * 19 = 14.25  -> lo = 14, frac = 0.25
 *
 * Every fraction lands on a clean quarter, so the weights are exact
 * hundredths and the whole computation stays in integers.
 */
const RUNG_WEIGHTS: Record<Rung, { lo: number; wLo: number; wHi: number }> = {
  tight: { lo: 4, wLo: 25, wHi: 75 },
  fair: { lo: 9, wLo: 50, wHi: 50 },
  wide: { lo: 14, wLo: 75, wHi: 25 },
};

/** Absolute move in percent to integer basis points. 1.55 -> 155. */
export function toBps(pct: number): number {
  return Math.round(pct * 100);
}

/** Basis points back to percent, for display only. 155 -> 1.55. */
export function bpsToPct(bps: number): number {
  return bps / 100;
}

/**
 * The strike a sorted series implies for one rung, in basis points.
 *
 * Interpolating rather than snapping to the nearer observation matters at
 * n = 20: P50 falls exactly between the 10th and 11th values, and rounding to
 * one of them would tilt the one rung that has to be a genuine coin flip.
 */
export function percentileBps(sortedAscBps: readonly number[], rung: Rung): number {
  if (sortedAscBps.length !== 20) {
    throw new Error(`percentileBps expects 20 samples, got ${sortedAscBps.length}`);
  }

  const { lo, wLo, wHi } = RUNG_WEIGHTS[rung];
  const weighted = sortedAscBps[lo] * wLo + sortedAscBps[lo + 1] * wHi;

  // Round half up, matching the Rust side exactly.
  return Math.floor((weighted + 50) / 100);
}

/**
 * The three thresholds, read straight out of the ticker's own recent
 * behaviour. No model, no forecast, no tuning: sort the last 20 absolute
 * moves and read off the quarter, half and three-quarter marks.
 *
 * The median is what makes this robust. One violent session lands at the
 * right edge of the sorted list and cannot drag the middle, where an average
 * would have been pulled with it.
 */
export function ladderBps(sortedAscBps: readonly number[]): Record<Rung, number> {
  return {
    tight: percentileBps(sortedAscBps, "tight"),
    fair: percentileBps(sortedAscBps, "fair"),
    wide: percentileBps(sortedAscBps, "wide"),
  };
}

/** Rejects a series the percentile would silently misread. */
export function assertSorted(samplesBps: readonly number[]): void {
  for (let i = 1; i < samplesBps.length; i++) {
    if (samplesBps[i] < samplesBps[i - 1]) {
      throw new Error(
        `sample series is not sorted ascending at index ${i}: ${samplesBps[i - 1]} then ${samplesBps[i]}`,
      );
    }
  }
}
