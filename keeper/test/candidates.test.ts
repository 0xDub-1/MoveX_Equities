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
    expect(hourly).toHaveLength(6);
    expect(hourly[0].sessionId).toBe('0914-1000');
  });
});
