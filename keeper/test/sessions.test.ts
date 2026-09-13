import type { DailyBar } from '../lib/lambdas/strikes/providers/types';
import {
  takeWindow,
  toCloseToCloseMoves,
  validateWindow,
} from '../lib/lambdas/strikes/sessions';

/** Five consecutive weekdays starting Monday 2026-09-07. */
const WEEK: DailyBar[] = [
  { date: '2026-09-07', close: 100 },
  { date: '2026-09-08', close: 102 },
  { date: '2026-09-09', close: 102 },
  { date: '2026-09-10', close: 99.96 },
  { date: '2026-09-11', close: 105 },
];

describe('toCloseToCloseMoves', () => {
  it('produces one fewer move than it has closes', () => {
    expect(toCloseToCloseMoves(WEEK)).toHaveLength(WEEK.length - 1);
  });

  it('measures against the previous close, not the same session open', () => {
    const [first] = toCloseToCloseMoves(WEEK);
    expect(first).toMatchObject({
      date: '2026-09-08',
      prevDate: '2026-09-07',
      prevClose: 100,
      close: 102,
    });
    expect(first.movePct).toBeCloseTo(2, 10);
  });

  it('discards direction, so a drop and a rally of equal size are equal', () => {
    const up = toCloseToCloseMoves([
      { date: '2026-09-07', close: 100 },
      { date: '2026-09-08', close: 104 },
    ])[0];
    const down = toCloseToCloseMoves([
      { date: '2026-09-07', close: 100 },
      { date: '2026-09-08', close: 96 },
    ])[0];

    expect(up.movePct).toBeCloseTo(down.movePct, 10);
  });

  it('reports a flat session as exactly zero', () => {
    const moves = toCloseToCloseMoves(WEEK);
    expect(moves[1].movePct).toBe(0);
  });

  it('returns nothing when there is only one close', () => {
    expect(toCloseToCloseMoves([WEEK[0]])).toEqual([]);
    expect(toCloseToCloseMoves([])).toEqual([]);
  });
});

describe('takeWindow', () => {
  it('keeps the most recent sessions, oldest first', () => {
    const window = takeWindow(toCloseToCloseMoves(WEEK), 2);
    expect(window.map((m) => m.date)).toEqual(['2026-09-10', '2026-09-11']);
  });
});

describe('validateWindow', () => {
  const moves = toCloseToCloseMoves(WEEK);

  it('accepts a clean window', () => {
    expect(validateWindow('TEST', moves, 4)).toEqual([]);
  });

  it('rejects a window that is short, which is how a holiday bug shows up', () => {
    expect(() => validateWindow('TEST', moves, 20)).toThrow(
      /expected 20 sessions in the window, got 4/,
    );
  });

  it('rejects duplicate sessions', () => {
    const dupe = [moves[0], { ...moves[0] }];
    expect(() => validateWindow('TEST', dupe, 2)).toThrow(/duplicate session/);
  });

  it('rejects sessions that are out of order', () => {
    const reversed = [moves[1], moves[0]];
    expect(() => validateWindow('TEST', reversed, 2)).toThrow(/out of order/);
  });

  it('rejects a weekend, which cannot be a trading session', () => {
    // 2026-09-12 is a Saturday.
    const weekend = toCloseToCloseMoves([
      { date: '2026-09-11', close: 100 },
      { date: '2026-09-12', close: 101 },
    ]);
    expect(() => validateWindow('TEST', weekend, 1)).toThrow(/weekend/);
  });

  it('rejects a non-positive close rather than dividing by it', () => {
    const bad = toCloseToCloseMoves([
      { date: '2026-09-10', close: 0 },
      { date: '2026-09-11', close: 100 },
    ]);
    expect(() => validateWindow('TEST', bad, 1)).toThrow(/non-positive close/);
  });

  it('warns on a gap wider than a long weekend without refusing to run', () => {
    // A dropped session and a market holiday are indistinguishable here, so
    // this surfaces for a human instead of blocking the open.
    const gapped = toCloseToCloseMoves([
      { date: '2026-09-01', close: 100 },
      { date: '2026-09-11', close: 101 },
    ]);
    const warnings = validateWindow('TEST', gapped, 1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/10-day gap/);
  });

  it('warns on an implausibly large move without clamping it', () => {
    const huge = toCloseToCloseMoves([
      { date: '2026-09-10', close: 100 },
      { date: '2026-09-11', close: 160 },
    ]);
    const warnings = validateWindow('TEST', huge, 1);
    expect(warnings.some((w) => /moved 60\.00%/.test(w))).toBe(true);
  });
});
