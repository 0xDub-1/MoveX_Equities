import {
  CRYPTO_ASSETS,
  CRYPTO_DAILY_LOOKAHEAD_DAYS,
  CRYPTO_DAILY_LOOKBACK_DAYS,
  CRYPTO_HOURLY_LEAD_HOURS,
  CRYPTO_HOURLY_LOOKBACK_HOURS,
} from '../lib/lambdas/shared/crypto-config';
import {
  cryptoCandidates,
  dailyId,
  dailyLockTs,
  dailySlotsAhead,
  dailySpec,
  hourlyId,
  hourlyLockTs,
  hourlySlotsAhead,
  hourlySpec,
  isHourlyId,
} from '../lib/lambdas/shared/utc-sessions';

const T = (iso: string) => Date.parse(iso) / 1000;

const ladder = {
  samplesBps: Array.from({ length: 20 }, (_, i) => i + 1),
  strikes: { tight: 5, fair: 10, wide: 15 },
  strikeBps: 10,
};

describe('identifiers', () => {
  /**
   * Nine characters mean hourly and ten mean daily to the crank and the
   * frontend, so the crypto ids keep exactly those widths.
   */
  it('names an hour with nine characters, the year included', () => {
    const id = hourlyId(T('2026-09-21T18:00:00Z'));
    expect(id).toBe('260921-18');
    expect(id).toHaveLength(9);
    expect(isHourlyId(id)).toBe(true);
    expect(hourlyLockTs(id)).toBe(T('2026-09-21T18:00:00Z'));
  });

  it('names a day with the ten character UTC date', () => {
    const id = dailyId(T('2026-09-22T00:00:00Z'));
    expect(id).toBe('2026-09-22');
    expect(id).toHaveLength(10);
    expect(isHourlyId(id)).toBe(false);
    expect(dailyLockTs(id)).toBe(T('2026-09-22T00:00:00Z'));
  });

  it('refuses a lock that is not on the boundary it names', () => {
    expect(() => hourlyId(T('2026-09-21T18:30:00Z'))).toThrow(/not on the hour/);
    expect(() => dailyId(T('2026-09-22T01:00:00Z'))).toThrow(/not midnight/);
  });

  /**
   * The reason the year is in the hourly id. A market's address is derived
   * from it and the account never goes away, so `0921-1800` would collide
   * with itself twelve months later.
   */
  it('does not collide across years', () => {
    expect(hourlyId(T('2026-01-01T00:00:00Z'))).toBe('260101-00');
    expect(hourlyId(T('2027-01-01T00:00:00Z'))).toBe('270101-00');
  });

  it('rejects malformed ids', () => {
    expect(() => hourlyLockTs('0921-1800')).toThrow(/not an hourly id/);
    expect(() => dailyLockTs('260921-18')).toThrow(/not a daily id/);
  });
});

describe('hourlySlotsAhead', () => {
  it('names the next four whole hours from five past the hour', () => {
    const slots = hourlySlotsAhead(T('2026-09-21T14:05:00Z'));
    expect(slots.map((s) => s.sessionId)).toEqual(['260921-15', '260921-16', '260921-17', '260921-18']);
    expect(slots[0].lockTs).toBe(T('2026-09-21T15:00:00Z'));
    expect(slots[0].settleTs).toBe(T('2026-09-21T16:00:00Z'));
    expect(slots[3].lockTs).toBe(T('2026-09-21T18:00:00Z'));
  });

  /** A lock has to be strictly in the future, so on the hour means the next one. */
  it('starts at the next hour when called exactly on the hour', () => {
    const slots = hourlySlotsAhead(T('2026-09-21T14:00:00Z'));
    expect(slots[0].sessionId).toBe('260921-15');
    expect(slots).toHaveLength(CRYPTO_HOURLY_LEAD_HOURS);
  });

  it('crosses midnight into the next date', () => {
    const slots = hourlySlotsAhead(T('2026-09-21T22:30:00Z'));
    expect(slots.map((s) => s.sessionId)).toEqual(['260921-23', '260922-00', '260922-01', '260922-02']);
  });

  it('honours a different lead', () => {
    expect(hourlySlotsAhead(T('2026-09-21T14:05:00Z'), 2).map((s) => s.sessionId)).toEqual([
      '260921-15',
      '260921-16',
    ]);
  });
});

describe('dailySlotsAhead', () => {
  it('names the next midnight just after the previous one has passed', () => {
    const slots = dailySlotsAhead(T('2026-09-21T00:10:00Z'));
    expect(slots.map((s) => s.sessionId)).toEqual(['2026-09-22']);
    expect(slots[0].lockTs).toBe(T('2026-09-22T00:00:00Z'));
    expect(slots[0].settleTs).toBe(T('2026-09-23T00:00:00Z'));
  });

  it('still names only the next midnight at the end of the day', () => {
    expect(dailySlotsAhead(T('2026-09-21T23:59:00Z')).map((s) => s.sessionId)).toEqual(['2026-09-22']);
  });

  it('is empty when the next midnight is beyond the lead', () => {
    expect(dailySlotsAhead(T('2026-09-21T12:00:00Z'), 4)).toEqual([]);
  });

  it('can reach two midnights with a longer lead', () => {
    expect(dailySlotsAhead(T('2026-09-21T12:00:00Z'), 48).map((s) => s.sessionId)).toEqual([
      '2026-09-22',
      '2026-09-23',
    ]);
  });
});

describe('cryptoCandidates', () => {
  const now = T('2026-09-21T14:05:00Z');
  const all = cryptoCandidates(now);
  const hourly = all.filter((c) => c.kind === 'hourly');
  const daily = all.filter((c) => c.kind === 'daily');

  it('lists hourly ids from the lookback to the lead, for hourly assets only', () => {
    const symbols = new Set(hourly.map((c) => c.symbol));
    expect(symbols).toEqual(new Set(CRYPTO_ASSETS.filter((a) => a.hourly).map((a) => a.symbol)));

    const btc = hourly.filter((c) => c.symbol === 'BTC').map((c) => c.sessionId);
    expect(btc[0]).toBe('260921-06');
    expect(btc[btc.length - 1]).toBe('260921-18');
    expect(btc).toHaveLength(CRYPTO_HOURLY_LOOKBACK_HOURS + CRYPTO_HOURLY_LEAD_HOURS + 1);
  });

  it('lists every daily rung of every asset from the lookback to the lookahead', () => {
    const dates = [...new Set(daily.map((c) => c.sessionId))];
    expect(dates[0]).toBe('2026-09-17');
    expect(dates[dates.length - 1]).toBe('2026-09-23');
    const rungs = CRYPTO_ASSETS.reduce((n, a) => n + a.dailyRungs.length, 0);
    expect(daily).toHaveLength((CRYPTO_DAILY_LOOKBACK_DAYS + CRYPTO_DAILY_LOOKAHEAD_DAYS + 1) * rungs);
  });

  it('includes tomorrow, which is the ladder the markets lambda creates today', () => {
    expect(daily.some((c) => c.sessionId === '2026-09-22' && c.symbol === 'SOL' && c.tier === 'wide')).toBe(true);
  });

  it('keeps the two id widths apart', () => {
    for (const c of hourly) expect(c.sessionId).toHaveLength(9);
    for (const c of daily) expect(c.sessionId).toHaveLength(10);
  });
});

describe('specs', () => {
  const slot = { sessionId: '260921-18', lockTs: T('2026-09-21T18:00:00Z'), settleTs: T('2026-09-21T19:00:00Z') };

  it('builds an hourly spec on the fair rung with the slot times', () => {
    const spec = hourlySpec('BTC', slot, ladder);
    expect(spec).toMatchObject({
      symbol: 'BTC',
      sessionId: '260921-18',
      tier: 'fair',
      strikeBps: 10,
      lockTs: slot.lockTs,
      settleTs: slot.settleTs,
      kind: 'hourly',
    });
    expect(spec.samplesBps).toHaveLength(20);
  });

  it('builds a daily spec with the strike of its own rung', () => {
    const day = { sessionId: '2026-09-22', lockTs: T('2026-09-22T00:00:00Z'), settleTs: T('2026-09-23T00:00:00Z') };
    expect(dailySpec('ETH', day, 'wide', ladder)).toMatchObject({ tier: 'wide', strikeBps: 15, kind: 'daily' });
    expect(dailySpec('ETH', day, 'tight', ladder).strikeBps).toBe(5);
  });
});
