import {
  assertSorted,
  bpsToPct,
  ladderBps,
  percentileBps,
  toBps,
} from '../lib/lambdas/strikes/strikes';

/**
 * NVDA's real trailing-20 close-to-close series for the window ending
 * 2026-09-11, in basis points, sorted ascending.
 *
 * This is the exact series quoted in the public docs, and the identical
 * fixture lives in the Rust program's strike.rs. Both sides assert the same
 * ladder from it, which is what keeps the off-chain keeper and the on-chain
 * verification from ever disagreeing.
 */
const NVDA_BPS = [
  3, 6, 7, 33, 84, 91, 98, 99, 148, 151,
  159, 180, 201, 219, 234, 237, 291, 321, 457, 874,
];

describe('toBps / bpsToPct', () => {
  it('converts percent to integer basis points', () => {
    expect(toBps(1.55)).toBe(155);
    expect(toBps(0.3)).toBe(30);
    expect(toBps(12.5)).toBe(1250);
  });

  it('always returns an integer, because the program compares integers', () => {
    for (const pct of [0.0298, 1.5512, 8.7449, 0.005]) {
      expect(Number.isInteger(toBps(pct))).toBe(true);
    }
  });

  it('round-trips through the display projection', () => {
    for (const bps of NVDA_BPS) {
      expect(toBps(bpsToPct(bps))).toBe(bps);
    }
  });
});

describe('percentileBps', () => {
  it('reproduces the published NVDA ladder', () => {
    expect(percentileBps(NVDA_BPS, 'tight')).toBe(89);
    expect(percentileBps(NVDA_BPS, 'fair')).toBe(155);
    expect(percentileBps(NVDA_BPS, 'wide')).toBe(235);
  });

  it('interpolates rather than snapping to a neighbour', () => {
    // P50 sits exactly between index 9 (151) and index 10 (159). Snapping
    // would give 151 or 159; the midpoint is 155.
    expect(percentileBps(NVDA_BPS, 'fair')).toBe(155);
    expect(NVDA_BPS[9]).toBe(151);
    expect(NVDA_BPS[10]).toBe(159);
  });

  it('rounds half up, matching the Rust side', () => {
    // P25 lands on 89.25 and P75 on 234.75 for this series.
    expect(percentileBps(NVDA_BPS, 'tight')).toBe(89);
    expect(percentileBps(NVDA_BPS, 'wide')).toBe(235);
  });

  it('refuses a series that is not 20 long', () => {
    expect(() => percentileBps(NVDA_BPS.slice(0, 19), 'fair')).toThrow(/20 samples/);
    expect(() => percentileBps([], 'fair')).toThrow(/20 samples/);
  });
});

describe('ladderBps', () => {
  it('produces a monotonically widening ladder', () => {
    const { tight, fair, wide } = ladderBps(NVDA_BPS);
    expect(tight).toBeLessThanOrEqual(fair);
    expect(fair).toBeLessThanOrEqual(wide);
  });

  it('resists a single violent session, which is why it is a median', () => {
    // Ten-fold the largest move. It stays at the right edge of the sorted
    // list and cannot drag the middle. An average would have moved.
    const extreme = [...NVDA_BPS.slice(0, 19), 8740];
    expect(ladderBps(extreme).fair).toBe(155);
    expect(ladderBps(extreme).tight).toBe(89);
  });

  it('collapses to the same value when every session moved identically', () => {
    expect(ladderBps(Array(20).fill(200))).toEqual({
      tight: 200,
      fair: 200,
      wide: 200,
    });
  });

  it('handles an all-zero series without producing NaN', () => {
    expect(ladderBps(Array(20).fill(0))).toEqual({ tight: 0, fair: 0, wide: 0 });
  });
});

describe('assertSorted', () => {
  it('accepts a sorted series', () => {
    expect(() => assertSorted(NVDA_BPS)).not.toThrow();
  });

  it('accepts ties', () => {
    expect(() => assertSorted(Array(20).fill(7))).not.toThrow();
  });

  it('rejects an out-of-order series rather than misreading it', () => {
    const unsorted = [...NVDA_BPS];
    [unsorted[0], unsorted[19]] = [unsorted[19], unsorted[0]];
    expect(() => assertSorted(unsorted)).toThrow(/not sorted ascending/);
  });
});
