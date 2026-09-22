// =============================================================================
// The board: instruments, stages, labels and copy
// =============================================================================
//
// Everything the trading page decides without rendering: how a market is
// labelled on its card, which stage it is in, what the tabs and empty states
// say on each venue, and the fixed hour axis the hourly strip is drawn on.
// Pure functions over MarketView, so the page and the preview agree.

import { venueOfSymbol } from "./assets";
import {
  DAILY_POST_MINUTES,
  HOURLY_FIRST_LOCK_MINUTES,
  HOURLY_POST_MINUTES,
  closeMinutes,
  easternTimestamp,
  etDate,
  fmtPostTime,
  isTradingDay,
  nextPostTs,
  nextTradingDay,
} from "./calendar";
import { dateOf, fmtDay, fmtTime } from "./clock";
import { tabOf, type Tab } from "./groups";
import { TIER_META, phaseOf, type MarketKind, type MarketView } from "./market";
import { DAY_SECS, HOUR_SECS } from "./sessions";
import { VENUES, type Venue } from "./venue";

export type Instrument = MarketKind;
export type Stage = Tab;

export const INSTRUMENTS: readonly Instrument[] = ["hourly", "daily"];
export const STAGES: readonly Stage[] = ["open", "live", "resolved"];

export const STAGE_META: Record<Stage, { label: string; hint: string }> = {
  open: { label: "Open", hint: "Taking deposits" },
  live: { label: "Live", hint: "Locked and being measured" },
  resolved: { label: "Settled", hint: "Paid out or refunded" },
};

export function stageOf(m: MarketView, nowSec: number): Stage {
  return tabOf(phaseOf(m, nowSec));
}

// ---------------------------------------------------------------------------
// Card labels
// ---------------------------------------------------------------------------

export interface SlotLabel {
  /** `TIGHT` or `14:00 to 15:00`. */
  main: string;
  /** `25th pct` or `UTC · Tue, Sep 22`. */
  aside: string;
}

/**
 * The one line that differs between a daily card and an hourly one. A daily
 * card names its rung; an hourly card names its hour, and adds the day once
 * the hour is history or sits on another day than the venue's today.
 */
export function slotLabel(m: MarketView): SlotLabel {
  if (m.kind === "daily") {
    return { main: TIER_META[m.tier].label, aside: TIER_META[m.tier].percentile };
  }
  // The day is not part of the label: a grid of hours carries a day divider
  // wherever the day is not today or changes, so the card keeps to the hour
  // and the clock and never truncates at four columns.
  const venue = venueOfSymbol(m.symbol);
  const main = `${fmtTime(m.lockTs, venue)} to ${fmtTime(m.settleTs, venue)}`;
  return { main, aside: VENUES[venue].tz };
}


/** What the twenty samples are: sessions, days, session hours or hours. */
export function sampleUnit(m: MarketView): string {
  const venue = venueOfSymbol(m.symbol);
  if (m.kind === "hourly") return venue === "equities" ? "session hours" : "hours";
  return venue === "equities" ? "sessions" : "days";
}

/** The window one market measures, for a header line. */
export function windowLine(m: MarketView): string {
  const venue = venueOfSymbol(m.symbol);
  const from = `${fmtDay(m.lockTs, venue)}, ${fmtTime(m.lockTs, venue)}`;
  const to = `${fmtDay(m.settleTs, venue)}, ${fmtTime(m.settleTs, venue)}`;
  return `${from} to ${to} ${VENUES[venue].tz}`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const TAB_CAPTION: Record<Venue, Record<Instrument, string>> = {
  equities: { hourly: "Lock on the hour, settle on the next", daily: "Close to close" },
  crypto: { hourly: "Lock on the hour, settle on the next", daily: "Midnight to midnight UTC" },
};

/** The question and the rule, stated once per instrument. */
export const LEDE_COPY: Record<Venue, Record<Instrument, string>> = {
  equities: {
    hourly:
      "Will the stock move more than the day's threshold, either direction, within the hour? One market per session hour, every one of them on the same threshold.",
    daily:
      "Will the stock move more than the threshold, either direction, close to close? TIGHT, FAIR and WIDE are the 25th, 50th and 75th percentiles of the last 20 sessions, each its own market.",
  },
  crypto: {
    hourly:
      "Will the asset move more than the hour's threshold, either direction? One market every hour, each threshold read from the 20 hours before it was posted, 4 always posted ahead.",
    daily:
      "Will the asset move more than the threshold, either direction, midnight to midnight UTC? TIGHT, FAIR and WIDE are the 25th, 50th and 75th percentiles of the last 20 days, each its own market.",
  },
};

export interface EmptyCopy {
  title: string;
  body: string;
  /** When set, the body is followed by a countdown to this instant. */
  untilTs?: number;
  untilLabel?: string;
}

function tryEquities<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    // The calendar does not cover the year asked about.
    return null;
  }
}

/** What an empty stage says, per instrument and venue. */
export function emptyCopy(venue: Venue, kind: Instrument, stage: Stage, nowSec: number): EmptyCopy {
  const at = new Date(nowSec * 1000);
  if (kind === "hourly") {
    if (stage === "open") {
      if (venue === "crypto") {
        return {
          title: "No hours taking deposits",
          body: "Hours are posted four ahead, around the clock. The next one appears within minutes.",
        };
      }
      const ts = tryEquities(() => nextPostTs(at, HOURLY_POST_MINUTES));
      return {
        title: "No hours taking deposits",
        body: `The next session's hours post at ${fmtPostTime(HOURLY_POST_MINUTES)} ET.`,
        untilTs: ts ?? undefined,
        untilLabel: "Next posting in",
      };
    }
    if (stage === "live") {
      if (venue === "crypto") {
        const next = Math.floor(nowSec / HOUR_SECS) * HOUR_SECS + HOUR_SECS;
        return {
          title: "No hour being measured",
          body: `The next hour locks at ${fmtTime(next, "crypto")} UTC.`,
          untilTs: next,
          untilLabel: "In",
        };
      }
      const first = tryEquities(() => {
        const date = etDate(at);
        const today = isTradingDay(date) && easternTimestamp(date, HOURLY_FIRST_LOCK_MINUTES) > nowSec;
        return easternTimestamp(today ? date : nextTradingDay(date), HOURLY_FIRST_LOCK_MINUTES);
      });
      return {
        title: "No hour being measured",
        body: "Hours run from 10:00 ET to the close on session days.",
        untilTs: first ?? undefined,
        untilLabel: "First hour locks in",
      };
    }
    return { title: "No hours settled yet", body: "Settled hours stay on the board for the day." };
  }

  if (stage === "open") {
    if (venue === "crypto") {
      return {
        title: "No ladder taking deposits",
        body: "The ladder is posted a day ahead. A gap repairs itself within ten minutes.",
      };
    }
    const ts = tryEquities(() => nextPostTs(at, DAILY_POST_MINUTES));
    return {
      title: "No ladder taking deposits",
      body: `The daily ladder posts at ${fmtPostTime(DAILY_POST_MINUTES)} ET.`,
      untilTs: ts ?? undefined,
      untilLabel: "Next posting in",
    };
  }
  if (stage === "live") {
    if (venue === "crypto") {
      const midnight = Math.floor(nowSec / DAY_SECS) * DAY_SECS + DAY_SECS;
      return {
        title: "No ladder being measured",
        body: "The next ladder locks at 00:00 UTC.",
        untilTs: midnight,
        untilLabel: "In",
      };
    }
    return {
      title: "No ladder being measured",
      body: "The next session's ladder locks at the close and runs close to close.",
    };
  }
  return { title: "No ladder settled yet", body: "Settled ladders stay on the board." };
}

// ---------------------------------------------------------------------------
// The hour axis
// ---------------------------------------------------------------------------

export interface HourSlot {
  lockTs: number;
  market: MarketView | null;
}

/**
 * The fixed axis the hourly strip is drawn on, one slot per hour whether or
 * not a market exists for it, so a short fetch never reads as a short day.
 *
 * Equities: the six session hours of one day, 10:00 to 16:00 ET, the day of
 * the earliest hour still to settle or, once all have, of the latest one.
 * Crypto: a rolling day of twenty-four hours ending at the furthest hour
 * posted ahead, so the four open hours sit at the right and the twenty
 * before them fill the rest.
 */
/**
 * The hour the strip and the header line both speak for: the earliest one
 * still to settle or, once every hour has, the latest one on the board.
 */
export function leadHour(markets: readonly MarketView[], nowSec: number): MarketView | undefined {
  const sorted = [...markets].sort((a, b) => a.lockTs - b.lockTs);
  return sorted.find((m) => m.settleTs > nowSec) ?? sorted[sorted.length - 1];
}

export function hourSlotsOf(venue: Venue, markets: readonly MarketView[], nowSec: number): HourSlot[] {
  const byLock = new Map<number, MarketView>();
  for (const m of markets) byLock.set(m.lockTs, m);

  if (venue === "equities") {
    const pick = leadHour(markets, nowSec);
    if (!pick) return [];
    const date = dateOf(pick.lockTs, "equities");
    // A half day closes at 13:00, so the axis is read from the calendar
    // rather than assumed to be six hours long.
    const slots: HourSlot[] = [];
    for (let mins = HOURLY_FIRST_LOCK_MINUTES; mins < closeMinutes(date); mins += 60) {
      const lockTs = easternTimestamp(date, mins);
      slots.push({ lockTs, market: byLock.get(lockTs) ?? null });
    }
    return slots;
  }

  const ahead = markets.filter((m) => m.lockTs > nowSec).map((m) => m.lockTs);
  const end = ahead.length > 0 ? Math.max(...ahead) : Math.floor(nowSec / HOUR_SECS) * HOUR_SECS + HOUR_SECS;
  const slots: HourSlot[] = [];
  for (let i = 23; i >= 0; i--) {
    const lockTs = end - i * HOUR_SECS;
    slots.push({ lockTs, market: byLock.get(lockTs) ?? null });
  }
  return slots;
}
