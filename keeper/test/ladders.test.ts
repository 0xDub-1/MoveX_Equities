import { intradayMoves } from '../lib/lambdas/shared/ladders';

/** An ET wall-clock hour as the ISO string the bar carries. */
function bar(etDate: string, etHour: number, close: number) {
  // September is US daylight time, UTC-4.
  const utcHour = String(etHour + 4).padStart(2, '0');
  return { date: `${etDate}T${utcHour}:00:00.000Z`, close };
}

describe('intradayMoves', () => {
  it('measures consecutive hours inside one session', () => {
    const moves = intradayMoves('NVDA', [
      bar('2026-09-16', 10, 100),
      bar('2026-09-16', 11, 101),
      bar('2026-09-16', 12, 100),
    ]);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toBeCloseTo(1, 6);
    expect(moves[1]).toBeCloseTo(0.990099, 5);
  });

  /**
   * The bug this function exists to prevent. Bars arrive as one continuous
   * array, so the close of one session sits beside the open of the next, and
   * measuring that pair puts a daily-magnitude gap into an hourly series.
   */
  it('never measures across the overnight gap', () => {
    const moves = intradayMoves('NVDA', [
      bar('2026-09-16', 15, 100), // last hour of Wednesday
      bar('2026-09-17', 10, 108), // first hour of Thursday, 8% gap up
      bar('2026-09-17', 11, 109),
    ]);

    expect(moves).toHaveLength(1);
    expect(moves[0]).toBeCloseTo(0.9259, 3); // 108 -> 109 only
    // The 8% gap must not appear anywhere in the series.
    expect(Math.max(...moves)).toBeLessThan(2);
  });

  it('drops every cross-session pair, not just the first', () => {
    const bars = [
      bar('2026-09-14', 15, 100),
      bar('2026-09-15', 10, 120),
      bar('2026-09-15', 11, 121),
      bar('2026-09-16', 10, 140),
      bar('2026-09-16', 11, 141),
    ];
    const moves = intradayMoves('NVDA', bars);
    // Five bars across three days: only the two same-day pairs survive.
    expect(moves).toHaveLength(2);
    for (const m of moves) expect(m).toBeLessThan(2);
  });

  it('returns nothing when every bar is from a different day', () => {
    expect(
      intradayMoves('NVDA', [
        bar('2026-09-14', 10, 100),
        bar('2026-09-15', 10, 110),
        bar('2026-09-16', 10, 120),
      ]),
    ).toEqual([]);
  });

  it('rejects a non-positive close rather than dividing by it', () => {
    expect(() =>
      intradayMoves('NVDA', [bar('2026-09-16', 10, 0), bar('2026-09-16', 11, 100)]),
    ).toThrow(/non-positive/);
  });

  it('reports a flat hour as exactly zero', () => {
    const moves = intradayMoves('NVDA', [
      bar('2026-09-16', 10, 100),
      bar('2026-09-16', 11, 100),
    ]);
    expect(moves).toEqual([0]);
  });
});
