import { candidates } from '../lib/lambdas/shared/candidates';

const daily = (c: { sessionId: string }) => c.sessionId.length === 10;

describe('crank candidates', () => {
  /**
   * The bug this pins. A daily market that locks at Monday's close is keyed
   * by Tuesday, the date it settles. A scan that starts at today and walks
   * backward never sees it on the day it needs locking.
   */
  it('includes the next session, so a daily market is found on its lock day', () => {
    const ids = candidates('2026-09-14').filter(daily).map((c) => c.sessionId);
    expect(ids).toContain('2026-09-15');
  });

  it('skips the weekend when looking ahead from a Friday', () => {
    const ids = candidates('2026-09-11').filter(daily).map((c) => c.sessionId);
    expect(ids).toContain('2026-09-14');
    expect(ids).not.toContain('2026-09-12');
  });

  it('still looks back several days for anything a missed tick left behind', () => {
    const ids = candidates('2026-09-14').filter(daily).map((c) => c.sessionId);
    expect(ids).toContain('2026-09-14');
    expect(ids).toContain('2026-09-10');
  });

  it('lists every rung of every ticker for each date', () => {
    const forTuesday = candidates('2026-09-14').filter((c) => c.sessionId === '2026-09-15');
    // 3 tickers x 3 rungs
    expect(forTuesday).toHaveLength(9);
  });

  it('includes the session hourly slots on a trading day', () => {
    const hourly = candidates('2026-09-14').filter((c) => !daily(c));
    const today = hourly.filter((c) => c.sessionId.startsWith('0914-'));
    expect(today).toHaveLength(6);
    expect(today[0].sessionId).toBe('0914-1000');
  });
});

describe('crank candidates, next session hourly', () => {
  /**
   * The hourly markets for a session are created at 15:55 the evening
   * before. The seeder funds whatever candidates lists, so leaving the next
   * session out would hand those markets an empty book all night and hand
   * the morning's first hour no counterparty.
   */
  it('includes the next session hourly slots, created the evening before', () => {
    const hourly = candidates('2026-09-14').filter((c) => !daily(c));
    expect(hourly.filter((c) => c.sessionId.startsWith('0915-'))).toHaveLength(6);
  });

  it('skips the weekend, so Friday evening lists Monday hours', () => {
    const hourly = candidates('2026-09-11').filter((c) => !daily(c));
    expect(hourly.filter((c) => c.sessionId.startsWith('0914-'))).toHaveLength(6);
    expect(hourly.some((c) => c.sessionId.startsWith('0912-'))).toBe(false);
  });

  it('lists the next session even when today is not one', () => {
    // Saturday. No hours today, but Monday's are already on chain.
    const hourly = candidates('2026-09-12').filter((c) => !daily(c));
    expect(hourly.filter((c) => c.sessionId.startsWith('0914-'))).toHaveLength(6);
  });
});

describe('crank candidates, two sessions ahead', () => {
  it('includes the session after next, so a market created at 15:55 is fundable the same hour', () => {
    const ids = candidates('2026-09-14').filter((c) => c.sessionId.length === 10).map((c) => c.sessionId);
    expect(ids).toContain('2026-09-16');
  });
});
