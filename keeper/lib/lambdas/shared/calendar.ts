// =============================================================================
// NYSE trading calendar
// =============================================================================
//
// Markets have to be created before the session starts, which means deciding
// whether today is a trading day without being able to look at whether it
// traded. A calendar is the only way to answer that in advance.
//
// The design principle here is fail closed. If the calendar does not cover
// the year being asked about, this refuses to answer rather than assuming a
// weekday is a session. An unmaintained list that stops creating markets is
// an annoyance; one that assumes every weekday trades seeds markets that can
// never settle, quietly, on Thanksgiving.
//
// Getting it wrong is also survivable by construction: a market created on a
// non-session day never receives a fresh price, `lock` refuses it, and
// `void_market` refunds everyone in full after the grace period. The calendar
// is an optimisation on top of a system that is already safe.

/** Full closures. Verified against the NYSE published calendar. */
const HOLIDAYS: Record<number, string[]> = {
  2026: [
    "2026-01-01", // New Year's Day
    "2026-01-19", // Martin Luther King Jr. Day
    "2026-02-16", // Washington's Birthday
    "2026-04-03", // Good Friday
    "2026-05-25", // Memorial Day
    "2026-06-19", // Juneteenth
    "2026-07-03", // Independence Day observed (Jul 4 is a Saturday)
    "2026-09-07", // Labor Day
    "2026-11-26", // Thanksgiving
    "2026-12-25", // Christmas
  ],
  2027: [
    "2027-01-01",
    "2027-01-18",
    "2027-02-15",
    "2027-03-26", // Good Friday
    "2027-05-31",
    "2027-06-18", // Juneteenth observed (Jun 19 is a Saturday)
    "2027-07-05", // Independence Day observed (Jul 4 is a Sunday)
    "2027-09-06",
    "2027-11-25",
    "2027-12-24", // Christmas observed (Dec 25 is a Saturday)
  ],
};

/**
 * Early closes, 13:00 ET instead of 16:00.
 *
 * The subtle one. These are trading days, so a holiday check passes, but an
 * hourly market locking at 15:00 would need to settle at 16:00 against a feed
 * that stopped publishing two hours earlier.
 */
const HALF_DAYS: Record<number, string[]> = {
  2026: [
    "2026-07-02", // day before Independence Day observed
    "2026-11-27", // day after Thanksgiving
    "2026-12-24", // Christmas Eve
  ],
  2027: [
    "2027-11-26", // day after Thanksgiving
  ],
};

export const REGULAR_CLOSE_MINUTES = 16 * 60; // 16:00 ET
export const HALF_DAY_CLOSE_MINUTES = 13 * 60; // 13:00 ET
export const OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET

export class CalendarCoverageError extends Error {
  constructor(year: number) {
    super(
      `NYSE calendar has no entry for ${year}. Refusing to guess whether ` +
        `today is a trading session: add the year's holidays to calendar.ts.`,
    );
    this.name = "CalendarCoverageError";
  }
}

/** `YYYY-MM-DD` for an instant, in US Eastern. */
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function easternDate(at: Date = new Date()): string {
  return ET_DATE.format(at);
}

/** Minutes since midnight ET. */
export function easternMinutes(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function assertCovered(date: string): void {
  const year = Number(date.slice(0, 4));
  if (!HOLIDAYS[year]) throw new CalendarCoverageError(year);
}

/** Whether the NYSE holds a session on this date. Throws if uncovered. */
export function isTradingDay(date: string): boolean {
  assertCovered(date);
  if (isWeekend(date)) return false;
  return !HOLIDAYS[Number(date.slice(0, 4))].includes(date);
}

export function isHalfDay(date: string): boolean {
  assertCovered(date);
  return (HALF_DAYS[Number(date.slice(0, 4))] ?? []).includes(date);
}

/** Minutes since ET midnight at which the session ends. Throws if uncovered. */
export function closeMinutes(date: string): number {
  if (!isTradingDay(date)) {
    throw new Error(`${date} is not a trading day, it has no close`);
  }
  return isHalfDay(date) ? HALF_DAY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES;
}

/** Unix seconds for `HH:MM` ET on a given date. */
export function easternTimestamp(date: string, minutes: number): number {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");

  // Resolve the UTC offset by asking what this instant looks like in ET, then
  // correcting. Doing it this way rather than hardcoding -5/-4 means DST is
  // the runtime's problem, not ours, which is the same reason the EventBridge
  // schedules declare a timezone instead of a UTC hour.
  const naive = Date.parse(`${date}T${hh}:${mm}:00Z`);
  const asET = new Date(naive);
  const offsetMs =
    Date.parse(`${easternDate(asET)}T${etClock(asET)}:00Z`) - naive;
  return Math.round((naive - offsetMs) / 1000);
}

function etClock(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/** The next trading day strictly after `date`. */
export function nextTradingDay(date: string): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 15; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidate = cursor.toISOString().slice(0, 10);
    if (isTradingDay(candidate)) return candidate;
  }
  throw new Error(`no trading day found within 15 days of ${date}`);
}

export interface HourlySlot {
  /** Minutes since ET midnight when deposits close and the reference is taken. */
  lockMinutes: number;
  settleMinutes: number;
  /** Stable 10-byte market identifier, e.g. `0916-1000`. */
  sessionId: string;
}

/**
 * The hourly markets that fit inside a given session.
 *
 * Aligned to whole hours from 10:00, which leaves the opening half hour
 * unused rather than the closing one. The last slot settles exactly at the
 * close, the most liquid moment of the day; aligning the other way would
 * sacrifice it to a leftover half hour.
 *
 * On a half day the close is 13:00, so only the 10-11, 11-12 and 12-13 slots
 * exist. Creating the rest would produce markets that cannot settle.
 */
export function hourlySlots(date: string): HourlySlot[] {
  const close = closeMinutes(date);
  const slots: HourlySlot[] = [];

  for (let lock = 10 * 60; lock + 60 <= close; lock += 60) {
    const hh = String(Math.floor(lock / 60)).padStart(2, "0");
    slots.push({
      lockMinutes: lock,
      settleMinutes: lock + 60,
      sessionId: `${date.slice(5, 7)}${date.slice(8, 10)}-${hh}00`,
    });
  }

  return slots;
}

/**
 * Lock and settle dates for a daily market created on `createdOn`.
 *
 * It locks at the close of the next session and settles at the close of the
 * one after, which keeps deposits open for roughly 24 hours. Locking at the
 * close of the creation day instead would leave five minutes between the
 * 15:55 creation run and the lock, which is not a window anyone can join.
 */
export function dailyMarketDates(createdOn: string): { lockDate: string; settleDate: string } {
  const lockDate = nextTradingDay(createdOn);
  return { lockDate, settleDate: nextTradingDay(lockDate) };
}
