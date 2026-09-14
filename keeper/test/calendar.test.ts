import {
  CalendarCoverageError,
  closeMinutes,
  dailyMarketDates,
  easternDate,
  easternMinutes,
  easternTimestamp,
  hourlySlots,
  isHalfDay,
  isTradingDay,
  nextTradingDay,
} from '../lib/lambdas/shared/calendar';

describe('isTradingDay', () => {
  it('accepts an ordinary weekday', () => {
    expect(isTradingDay('2026-09-16')).toBe(true); // Wednesday
  });

  it('rejects weekends', () => {
    expect(isTradingDay('2026-09-12')).toBe(false); // Saturday
    expect(isTradingDay('2026-09-13')).toBe(false); // Sunday
  });

  it('rejects published holidays', () => {
    expect(isTradingDay('2026-11-26')).toBe(false); // Thanksgiving
    expect(isTradingDay('2026-12-25')).toBe(false); // Christmas
    expect(isTradingDay('2026-09-07')).toBe(false); // Labor Day
  });

  it('rejects a holiday observed on a different date than the holiday', () => {
    // 4 July 2026 falls on a Saturday, so the market closes the Friday.
    expect(isTradingDay('2026-07-03')).toBe(false);
  });

  /**
   * The property that matters most. An unmaintained calendar must stop
   * creating markets, not assume every weekday is a session and seed markets
   * that can never settle.
   */
  it('refuses to answer for a year it does not cover', () => {
    expect(() => isTradingDay('2035-06-11')).toThrow(CalendarCoverageError);
    expect(() => isTradingDay('2035-06-11')).toThrow(/Refusing to guess/);
  });
});

describe('half days', () => {
  it('knows the 13:00 closes', () => {
    expect(isHalfDay('2026-11-27')).toBe(true); // day after Thanksgiving
    expect(isHalfDay('2026-12-24')).toBe(true); // Christmas Eve
  });

  it('treats them as trading days, because they are', () => {
    expect(isTradingDay('2026-11-27')).toBe(true);
  });

  it('reports the earlier close', () => {
    expect(closeMinutes('2026-11-27')).toBe(13 * 60);
    expect(closeMinutes('2026-09-16')).toBe(16 * 60);
  });

  it('has no close on a day with no session', () => {
    expect(() => closeMinutes('2026-11-26')).toThrow(/not a trading day/);
  });
});

describe('hourlySlots', () => {
  it('fits six whole hours into a regular session', () => {
    const slots = hourlySlots('2026-09-16');
    expect(slots).toHaveLength(6);
    expect(slots[0].lockMinutes).toBe(10 * 60);
    expect(slots[5].settleMinutes).toBe(16 * 60);
  });

  it('leaves the opening half hour unused, never the close', () => {
    const slots = hourlySlots('2026-09-16');
    // The session opens at 09:30 but the first lock is 10:00, so the last
    // slot can settle exactly at the close rather than half an hour before.
    expect(slots[0].lockMinutes).toBeGreaterThan(9 * 60 + 30);
    expect(slots[slots.length - 1].settleMinutes).toBe(closeMinutes('2026-09-16'));
  });

  it('shortens to three slots on a half day', () => {
    const slots = hourlySlots('2026-11-27');
    expect(slots).toHaveLength(3);
    expect(slots[2].settleMinutes).toBe(13 * 60);
  });

  it('never produces a slot that settles after the close', () => {
    for (const date of ['2026-09-16', '2026-11-27', '2026-12-24']) {
      const close = closeMinutes(date);
      for (const slot of hourlySlots(date)) {
        expect(slot.settleMinutes).toBeLessThanOrEqual(close);
      }
    }
  });

  it('gives each slot a distinct 10-byte identifier', () => {
    const slots = hourlySlots('2026-09-16');
    const ids = slots.map((s) => s.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
    // The program's session_date seed is a fixed [u8; 10].
    for (const id of ids) expect(id).toHaveLength(9);
    expect(ids[0]).toBe('0916-1000');
  });
});

describe('nextTradingDay', () => {
  it('skips the weekend', () => {
    expect(nextTradingDay('2026-09-11')).toBe('2026-09-14'); // Fri -> Mon
  });

  it('skips a holiday too', () => {
    // Thanksgiving is Thursday 26 Nov 2026; the 27th is a half day but open.
    expect(nextTradingDay('2026-11-25')).toBe('2026-11-27');
  });
});

describe('eastern time helpers', () => {
  it('reads the ET date for an instant', () => {
    // 01:00 UTC on the 17th is still the 16th in New York.
    expect(easternDate(new Date('2026-09-17T01:00:00Z'))).toBe('2026-09-16');
  });

  it('reads minutes since ET midnight', () => {
    // 20:00 UTC in September is 16:00 ET (daylight time).
    expect(easternMinutes(new Date('2026-09-16T20:00:00Z'))).toBe(16 * 60);
  });

  it('converts an ET wall clock to a unix timestamp across DST', () => {
    // September is daylight time, UTC-4: 16:00 ET is 20:00 UTC.
    const summer = easternTimestamp('2026-09-16', 16 * 60);
    expect(new Date(summer * 1000).toISOString()).toBe('2026-09-16T20:00:00.000Z');

    // January is standard time, UTC-5: 16:00 ET is 21:00 UTC. Hardcoding an
    // offset instead would silently shift every settlement by an hour after
    // the first Sunday in November.
    const winter = easternTimestamp('2026-01-15', 16 * 60);
    expect(new Date(winter * 1000).toISOString()).toBe('2026-01-15T21:00:00.000Z');
  });
});

describe('dailyMarketDates', () => {
  it('locks at the next session and settles the one after', () => {
    expect(dailyMarketDates('2026-09-14')).toEqual({
      lockDate: '2026-09-15',
      settleDate: '2026-09-16',
    });
  });

  /**
   * The bug this pins. Locking on the creation day gave a five minute deposit
   * window, from the 15:55 creation run to the 16:00 close.
   */
  it('never locks on the day it is created', () => {
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-11']) {
      expect(dailyMarketDates(day).lockDate).not.toBe(day);
    }
  });

  it('skips weekends', () => {
    // Created Friday: lock Monday, settle Tuesday.
    expect(dailyMarketDates('2026-09-11')).toEqual({
      lockDate: '2026-09-14',
      settleDate: '2026-09-15',
    });
  });

  it('skips holidays', () => {
    // Created Wed 25 Nov. Thu 26 is Thanksgiving, so lock Fri 27, settle Mon 30.
    expect(dailyMarketDates('2026-11-25')).toEqual({
      lockDate: '2026-11-27',
      settleDate: '2026-11-30',
    });
  });
});
