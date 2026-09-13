import { computeLadder, percentile, round2, toBps } from '../lib/lambdas/strikes/strikes';

/**
 * NVDA's real trailing-20 close-to-close series for the window ending
 * 2026-09-11, sorted ascending. This is the exact series quoted in the
 * public docs, so these assertions pin the published numbers: if the maths
 * ever drifts, the docs become wrong and this test says so.
 */
const NVDA_SERIES = [
  0.03, 0.06, 0.07, 0.33, 0.84, 0.91, 0.98, 0.99, 1.48, 1.51,
  1.59, 1.8, 2.01, 2.19, 2.34, 2.37, 2.91, 3.21, 4.57, 8.74,
];

describe('percentile', () => {
  it('interpolates between neighbours', () => {
    // Midpoint of [0, 10] sits at index 0.5, so halfway between 0 and 10.
    expect(percentile([0, 10], 0.5)).toBe(5);
  });

  it('returns the exact element when the index lands on one', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('rejects an empty series rather than returning NaN', () => {
    expect(() => percentile([], 0.5)).toThrow(/empty/);
  });

  it('rejects a p outside [0, 1]', () => {
    expect(() => percentile([1, 2, 3], 1.5)).toThrow(/\[0, 1\]/);
    expect(() => percentile([1, 2, 3], -0.1)).toThrow(/\[0, 1\]/);
  });
});

describe('computeLadder', () => {
  it('reproduces the published NVDA ladder', () => {
    expect(computeLadder(NVDA_SERIES)).toEqual({
      tight: 0.89,
      fair: 1.55,
      wide: 2.35,
    });
  });

  it('does not depend on input order', () => {
    const shuffled = [...NVDA_SERIES].reverse();
    expect(computeLadder(shuffled)).toEqual(computeLadder(NVDA_SERIES));
  });

  it('produces a monotonically widening ladder', () => {
    const { tight, fair, wide } = computeLadder(NVDA_SERIES);
    expect(tight).toBeLessThanOrEqual(fair);
    expect(fair).toBeLessThanOrEqual(wide);
  });

  it('resists a single violent session, which is why it is a median', () => {
    // Ten-fold the largest move. It stays at the right edge of the sorted
    // list and cannot drag the middle. An average would have moved.
    const extreme = [...NVDA_SERIES.slice(0, 19), 87.4];
    expect(computeLadder(extreme).fair).toBe(1.55);
    expect(computeLadder(extreme).tight).toBe(0.89);
  });

  it('collapses to the same value when every session moved identically', () => {
    expect(computeLadder(Array(20).fill(2))).toEqual({ tight: 2, fair: 2, wide: 2 });
  });
});

describe('toBps', () => {
  it('converts percent to integer basis points', () => {
    expect(toBps(1.55)).toBe(155);
    expect(toBps(0.3)).toBe(30);
    expect(toBps(12.5)).toBe(1250);
  });

  it('always returns an integer, because the program compares integers', () => {
    for (const pct of NVDA_SERIES) {
      expect(Number.isInteger(toBps(pct))).toBe(true);
    }
  });
});

describe('round2', () => {
  it('quotes to two decimal places', () => {
    expect(round2(0.8925)).toBe(0.89);
    expect(round2(2.3475)).toBe(2.35);
    expect(round2(1.555)).toBe(1.56);
  });
});
