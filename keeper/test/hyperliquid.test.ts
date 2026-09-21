import {
  INTERVAL_MS,
  closedCandles,
  ladderFromCandles,
  midToQuote,
  movesBps,
  type Candle,
} from '../lib/lambdas/shared/hyperliquid';

const H = INTERVAL_MS['1h'];

/** A flat bar opening at `t` and closing at `c`. */
function bar(t: number, c: number): Candle {
  return { t, T: t + H - 1, o: c, h: c, l: c, c, n: 1 };
}

describe('midToQuote', () => {
  it('scales the mid to the exponent the program stores', () => {
    expect(midToQuote('81234.5', 1_700_000_000).price).toBe(8_123_450_000_000n);
    expect(midToQuote('111.345', 1_700_000_000).price).toBe(11_134_500_000n);
  });

  /**
   * allMids carries no timestamp. The read time is the honest publish time:
   * a mid is the state of the book when it was asked for.
   */
  it('stamps the read time, one source, no confidence band', () => {
    const quote = midToQuote('2656.95', 1_789_000_000);
    expect(quote.publishTime).toBe(1_789_000_000);
    expect(quote.sourceCount).toBe(1);
    expect(quote.conf).toBe(0n);
  });

  it('refuses a missing or unusable mid', () => {
    expect(() => midToQuote(undefined, 1, 'XYZ')).toThrow(/no mid for XYZ/);
    expect(() => midToQuote('0', 1)).toThrow(/unusable/);
    expect(() => midToQuote('-5', 1)).toThrow(/unusable/);
    expect(() => midToQuote('abc', 1)).toThrow(/unusable/);
  });
});

describe('closedCandles', () => {
  /**
   * The last bar the server returns is the one in progress. Its close is the
   * last print, not a close, and it must never enter a calibration.
   */
  it('drops the bar still in progress', () => {
    const now = 10 * H + 5_000;
    const bars = [bar(8 * H, 1), bar(9 * H, 2), bar(10 * H, 3)];
    expect(closedCandles(bars, now).map((b) => b.c)).toEqual([1, 2]);
  });

  it('keeps a bar that closed this very millisecond', () => {
    const bars = [bar(8 * H, 1)];
    expect(closedCandles(bars, 9 * H)).toHaveLength(1);
    expect(closedCandles(bars, 9 * H - 1)).toHaveLength(0);
  });
});

describe('movesBps', () => {
  it('measures consecutive bars in basis points, direction discarded', () => {
    const moves = movesBps([bar(0, 100), bar(H, 101), bar(2 * H, 100)], '1h');
    expect(moves).toEqual([100, 99]);
  });

  it('skips a pair with a missing bar between them', () => {
    const moves = movesBps([bar(0, 100), bar(H, 110), bar(3 * H, 200)], '1h');
    expect(moves).toEqual([1000]);
  });

  it('rejects a non-positive close rather than dividing by it', () => {
    expect(() => movesBps([bar(0, 0), bar(H, 100)], '1h')).toThrow(/non-positive/);
  });

  it('measures daily bars on the daily step', () => {
    const D = INTERVAL_MS['1d'];
    const daily = (t: number, c: number): Candle => ({ t, T: t + D - 1, o: c, h: c, l: c, c, n: 1 });
    expect(movesBps([daily(0, 100), daily(D, 102)], '1d')).toEqual([200]);
    // An hourly step between daily bars is a corrupted series, not a move.
    expect(movesBps([daily(0, 100), daily(H, 102)], '1d')).toEqual([]);
  });
});

describe('ladderFromCandles', () => {
  /**
   * The twenty hourly moves the BTC tape produced on 21 September 2026, in
   * basis points. Sorted they read 1 2 5 6 10 13 13 15 17 19 19 22 22 23 24
   * 30 37 55 55 77, so the interpolated percentiles are P25 12, P50 19, P75
   * 26, the same integer maths the program re-derives on chain.
   */
  const MOVES = [77, 1, 55, 2, 55, 5, 37, 6, 30, 10, 24, 13, 23, 13, 22, 15, 22, 17, 19, 19];

  /** Bars whose closes step by the given moves, alternating direction. */
  function series(movesBps: number[], firstClose: number, start: number): Candle[] {
    const bars = [bar(start, firstClose)];
    let close = firstClose;
    movesBps.forEach((m, i) => {
      close = close * (1 + ((i % 2 === 0 ? 1 : -1) * m) / 10_000);
      bars.push(bar(start + (i + 1) * H, close));
    });
    return bars;
  }

  it('reads the last twenty closed moves, sorts them and interpolates the rungs', () => {
    // Two older moves that must fall outside the window, then the twenty,
    // then a bar still in progress.
    const bars = series([999, 999, ...MOVES], 80_000, 0);
    const inProgress = bar(bars[bars.length - 1].t + H, 1);
    const now = inProgress.t + 5_000;

    const ladder = ladderFromCandles([...bars, inProgress], '1h', now);

    expect(ladder.samplesBps).toEqual([...MOVES].sort((a, b) => a - b));
    expect(ladder.samplesBps).not.toContain(999);
    expect(ladder.strikes).toEqual({ tight: 12, fair: 19, wide: 26 });
    expect(ladder.strikeBps).toBe(19);
  });

  it('refuses a window short of twenty moves', () => {
    const bars = series(MOVES.slice(0, 10), 80_000, 0);
    expect(() => ladderFromCandles(bars, '1h', bars[bars.length - 1].T + 1)).toThrow(/need 20 1h moves/);
  });

  it('does not count the bar in progress toward the twenty', () => {
    // Exactly twenty moves once the running bar is excluded: fine. One
    // fewer closed bar and the window is short.
    const bars = series(MOVES, 80_000, 0);
    const running = bar(bars[bars.length - 1].t + H, 80_000);
    expect(() => ladderFromCandles([...bars, running], '1h', running.t + 1)).not.toThrow();
    expect(() => ladderFromCandles([...bars.slice(1), running], '1h', running.t + 1)).toThrow(/got 19/);
  });
});
