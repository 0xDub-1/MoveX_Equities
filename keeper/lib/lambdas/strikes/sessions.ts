// =============================================================================
// Session moves and window validation
// =============================================================================
//
// Turns a run of daily closes into the close-to-close move series the strike
// ladder is calibrated on, then refuses to hand it over unless it passes a
// set of structural checks.
//
// The checks are the point. A corrupted window does not throw on its own: it
// quietly produces a plausible-looking threshold from the wrong data, ships
// it to users, and settles real money against it. Every invariant that can
// be asserted cheaply, is.

import type { DailyBar } from "./providers/types";

/** One close-to-close move, carrying the two closes it was derived from. */
export interface SessionMove {
  /** The session being measured. */
  readonly date: string;
  /** The session it is measured against, normally the previous trading day. */
  readonly prevDate: string;
  readonly close: number;
  readonly prevClose: number;
  /** Absolute move in percent. Direction is deliberately discarded. */
  readonly movePct: number;
}

/**
 * Close-to-close, not open-to-close.
 *
 * Measuring within the session would make earnings invisible: a company
 * reports after the bell, the stock gaps 8% at the next open and then drifts
 * flat, and an open-to-close market records a 0.4% move on the most volatile
 * day of the quarter. Close-to-close also matches what everyone already
 * means by "how much did it move today".
 */
export function toCloseToCloseMoves(bars: readonly DailyBar[]): SessionMove[] {
  const moves: SessionMove[] = [];

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];

    moves.push({
      date: curr.date,
      prevDate: prev.date,
      close: curr.close,
      prevClose: prev.close,
      movePct: (Math.abs(curr.close - prev.close) / prev.close) * 100,
    });
  }

  return moves;
}

/** The most recent `count` moves, oldest first. */
export function takeWindow(moves: readonly SessionMove[], count: number): SessionMove[] {
  return moves.slice(-count);
}

/**
 * Structural checks on a calibration window.
 *
 * Throws on anything that makes the window unusable. Returns warnings for
 * things that are merely worth a human glance, because a market holiday and
 * a missing session look identical from here and we would rather log a
 * Thanksgiving than refuse to open markets over one.
 */
export function validateWindow(
  ticker: string,
  moves: readonly SessionMove[],
  expected: number,
): string[] {
  const fail = (msg: string): never => {
    throw new Error(`${ticker}: ${msg}`);
  };

  if (moves.length !== expected) {
    fail(`expected ${expected} sessions in the window, got ${moves.length}`);
  }

  const warnings: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];

    if (seen.has(m.date)) fail(`duplicate session ${m.date} in the window`);
    seen.add(m.date);

    if (i > 0 && m.date <= moves[i - 1].date) {
      fail(`sessions out of order: ${moves[i - 1].date} followed by ${m.date}`);
    }

    if (isWeekend(m.date)) fail(`${m.date} is a weekend, not a trading session`);

    if (!(m.prevClose > 0) || !(m.close > 0)) {
      fail(`${m.date} has a non-positive close (${m.prevClose} -> ${m.close})`);
    }

    if (!Number.isFinite(m.movePct)) fail(`${m.date} produced a non-finite move`);

    // A gap wider than a long weekend is usually a market holiday, which is
    // fine, but it is also what a silently dropped session looks like.
    const gapDays = calendarDaysBetween(m.prevDate, m.date);
    if (gapDays > 4) {
      warnings.push(`${gapDays}-day gap between ${m.prevDate} and ${m.date} (holiday?)`);
    }

    // Not impossible, and we must not clamp it, but a 25% close-to-close
    // move deserves a human confirming it was real before it widens a
    // threshold for the next month.
    if (m.movePct > 25) {
      warnings.push(`${m.date} moved ${m.movePct.toFixed(2)}%, verify this is real`);
    }
  }

  return warnings;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function calendarDaysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
