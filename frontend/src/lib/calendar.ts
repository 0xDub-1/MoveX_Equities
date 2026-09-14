// =============================================================================
// Eastern time and the trading session
// =============================================================================
//
// Markets are keyed to New York time, so the UI speaks it too. Everything
// here is pure and DST-safe: offsets come from Intl at the instant in
// question rather than from a hardcoded number.

export const ET = "America/New_York";

interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etParts(at: Date): EtParts {
  const parts = PARTS.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Some engines spell midnight as 24.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** `YYYY-MM-DD` in New York for an instant. */
export function etDate(at: Date = new Date()): string {
  const p = etParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since midnight in New York. */
export function etMinutes(at: Date = new Date()): number {
  const p = etParts(at);
  return p.hour * 60 + p.minute;
}

/** Minutes New York trails UTC at `at`: 240 in summer, 300 in winter. */
function etOffsetMinutes(at: Date): number {
  const p = etParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((at.getTime() - asUtc) / 60_000);
}

/** Unix seconds for a wall clock time in New York on `date`. */
export function easternTimestamp(date: string, minutes: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = etOffsetMinutes(new Date(guess));
  let ts = guess + first * 60_000;
  const second = etOffsetMinutes(new Date(ts));
  if (second !== first) ts = guess + second * 60_000;
  return Math.floor(ts / 1000);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TIME_SECONDS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  weekday: "long",
  month: "long",
  day: "numeric",
});

/** `16:00` in New York. */
export function fmtEtTime(tsSec: number): string {
  return TIME.format(new Date(tsSec * 1000)).replace(/^24/, "00");
}

export function fmtEtClock(at: Date): string {
  return TIME_SECONDS.format(at).replace(/^24/, "00");
}

/** `Mon, Sep 14`. */
export function fmtEtDay(tsSec: number): string {
  return DAY.format(new Date(tsSec * 1000));
}

/** `Monday, September 14`. */
export function fmtEtDayLong(tsSec: number): string {
  return DAY_LONG.format(new Date(tsSec * 1000));
}

/** `Mon, Sep 14 · 16:00 ET`. */
export function fmtEtDateTime(tsSec: number): string {
  return `${fmtEtDay(tsSec)} · ${fmtEtTime(tsSec)} ET`;
}

/** A `YYYY-MM-DD` session date as `Wed, Sep 16`. */
export function fmtSessionDate(date: string): string {
  return DAY.format(new Date(`${date}T12:00:00Z`));
}

// ---------------------------------------------------------------------------
// The NYSE session
// ---------------------------------------------------------------------------

/** Full closures, from the keeper's calendar. */
const HOLIDAYS: Record<number, string[]> = {
  2026: [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
  ],
  2027: [
    "2027-01-01",
    "2027-01-18",
    "2027-02-15",
    "2027-03-26",
    "2027-05-31",
    "2027-06-18",
    "2027-07-05",
    "2027-09-06",
    "2027-11-25",
    "2027-12-24",
  ],
};

/** Early closes at 13:00. */
const HALF_DAYS: Record<number, string[]> = {
  2026: ["2026-07-02", "2026-11-27", "2026-12-24"],
  2027: ["2027-11-26"],
};

export const OPEN_MINUTES = 9 * 60 + 30;
export const REGULAR_CLOSE_MINUTES = 16 * 60;
export const HALF_DAY_CLOSE_MINUTES = 13 * 60;

/**
 * When the keeper posts each kind of market, in minutes since ET midnight.
 *
 * The daily ladder goes out just before the close. The intraday hours go out
 * in the evening, for the next session, because their ladder is calibrated
 * on completed hours and at 15:55 the session's last hour is still running.
 */
export const HOURLY_POST_MINUTES = 20 * 60;
export const DAILY_POST_MINUTES = 15 * 60 + 55;

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function isTradingDay(date: string): boolean {
  if (isWeekend(date)) return false;
  const year = Number(date.slice(0, 4));
  return !(HOLIDAYS[year] ?? []).includes(date);
}

export function closeMinutes(date: string): number {
  const year = Number(date.slice(0, 4));
  return (HALF_DAYS[year] ?? []).includes(date) ? HALF_DAY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextTradingDay(date: string): string {
  let next = addDays(date, 1);
  for (let i = 0; i < 14 && !isTradingDay(next); i++) next = addDays(next, 1);
  return next;
}

/**
 * The next time the keeper runs a posting job, given the minute of the ET
 * day it runs at. Today's if it has not passed, otherwise the next session's.
 */
export function nextPostTs(at: Date, postMinutes: number): number {
  const date = etDate(at);
  if (isTradingDay(date) && etMinutes(at) < postMinutes) {
    return easternTimestamp(date, postMinutes);
  }
  return easternTimestamp(nextTradingDay(date), postMinutes);
}

/** `20:00`, for copy that names the hour the hours are posted. */
export function fmtPostTime(postMinutes: number): string {
  const h = String(Math.floor(postMinutes / 60)).padStart(2, "0");
  return `${h}:${String(postMinutes % 60).padStart(2, "0")}`;
}

export interface SessionStatus {
  /** Whether the regular session is trading right now. */
  open: boolean;
  label: string;
  /** What happens next and when, for the header clock. */
  nextLabel: string;
  nextTs: number;
}

/** Where the NYSE session is right now, and what the keeper does next. */
export function sessionStatus(at: Date = new Date()): SessionStatus {
  const date = etDate(at);
  const minutes = etMinutes(at);

  if (!isTradingDay(date)) {
    const next = nextTradingDay(date);
    return {
      open: false,
      label: isWeekend(date) ? "Weekend" : "Market holiday",
      nextLabel: `Session opens ${fmtSessionDate(next)} 09:30 ET`,
      nextTs: easternTimestamp(next, OPEN_MINUTES),
    };
  }

  const close = closeMinutes(date);

  if (minutes < OPEN_MINUTES) {
    return {
      open: false,
      label: "Pre-market",
      nextLabel: "Session opens at 09:30 ET",
      nextTs: easternTimestamp(date, OPEN_MINUTES),
    };
  }
  if (minutes < close) {
    const closeLabel = close === HALF_DAY_CLOSE_MINUTES ? "13:00" : "16:00";
    return {
      open: true,
      label: "Session open",
      nextLabel: `Closes at ${closeLabel} ET`,
      nextTs: easternTimestamp(date, close),
    };
  }
  // Closed for the day. The evening posting is the next thing that happens,
  // and once that is done the next session's open is.
  if (minutes < HOURLY_POST_MINUTES) {
    return {
      open: false,
      label: "After hours",
      nextLabel: `Next session's hours post at ${fmtPostTime(HOURLY_POST_MINUTES)} ET`,
      nextTs: easternTimestamp(date, HOURLY_POST_MINUTES),
    };
  }
  const next = nextTradingDay(date);
  return {
    open: false,
    label: "After hours",
    nextLabel: `Session opens ${fmtSessionDate(next)} 09:30 ET`,
    nextTs: easternTimestamp(next, OPEN_MINUTES),
  };
}
