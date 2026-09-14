import {
  DEPOSIT_MAX,
  DEPOSIT_MIN,
  SEED_WALLET_COUNT,
  chooseSide,
  randomAmount,
  seedBytes,
  shuffle,
} from '../lib/lambdas/shared/seeding';

const secret = Uint8Array.from({ length: 64 }, (_, i) => i);

/** A deterministic rng for tests: cycles through the given values. */
function rngOf(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('seedBytes', () => {
  it('is deterministic, so the same wallets come back every run', () => {
    expect(Buffer.from(seedBytes(secret, 0))).toEqual(Buffer.from(seedBytes(secret, 0)));
  });

  it('gives each index a different wallet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SEED_WALLET_COUNT; i++) {
      seen.add(Buffer.from(seedBytes(secret, i)).toString('hex'));
    }
    expect(seen.size).toBe(SEED_WALLET_COUNT);
  });

  it('produces a 32 byte seed', () => {
    expect(seedBytes(secret, 2)).toHaveLength(32);
  });

  it('changes with the publisher secret', () => {
    const other = Uint8Array.from({ length: 64 }, (_, i) => 99 - i);
    expect(Buffer.from(seedBytes(secret, 0))).not.toEqual(Buffer.from(seedBytes(other, 0)));
  });
});

describe('chooseSide', () => {
  /**
   * The rule that keeps the draw from ever leaving a market one-sided, which
   * would void it at lock for want of a counterparty.
   */
  it('fills an empty ABOVE first, regardless of the draw', () => {
    expect(chooseSide(0n, 500n, () => 0.99)).toBe('above');
  });

  it('fills an empty BELOW first, regardless of the draw', () => {
    expect(chooseSide(500n, 0n, () => 0.01)).toBe('below');
  });

  it('is random once both sides hold something', () => {
    expect(chooseSide(500n, 500n, () => 0.1)).toBe('above');
    expect(chooseSide(500n, 500n, () => 0.9)).toBe('below');
  });

  it('with three wallets on an empty market, both sides end up funded', () => {
    let above = 0n;
    let below = 0n;
    const rng = rngOf([0.7, 0.2, 0.9]);
    for (let w = 0; w < 3; w++) {
      const side = chooseSide(above, below, rng);
      if (side === 'above') above += 100n;
      else below += 100n;
    }
    expect(above).toBeGreaterThan(0n);
    expect(below).toBeGreaterThan(0n);
  });
});

describe('randomAmount', () => {
  it('stays inside the configured range at both extremes', () => {
    expect(randomAmount(() => 0)).toBe(DEPOSIT_MIN);
    expect(randomAmount(() => 1 - 1e-12)).toBe(DEPOSIT_MAX);
  });

  it('varies with the draw', () => {
    expect(randomAmount(() => 0.25)).not.toBe(randomAmount(() => 0.75));
  });

  it('never leaves the range under real randomness', () => {
    for (let i = 0; i < 500; i++) {
      const a = randomAmount();
      expect(a >= DEPOSIT_MIN).toBe(true);
      expect(a <= DEPOSIT_MAX).toBe(true);
    }
  });
});

describe('shuffle', () => {
  it('returns a permutation and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, rngOf([0.9, 0.1, 0.5, 0.3]));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('actually reorders under a non-trivial draw', () => {
    const out = shuffle([0, 1, 2, 3, 4, 5], rngOf([0.99, 0.01, 0.5]));
    expect(out).not.toEqual([0, 1, 2, 3, 4, 5]);
  });
});
