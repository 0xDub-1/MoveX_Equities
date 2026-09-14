// =============================================================================
// Strike ladders
// =============================================================================
//
// Two ladders per ticker, from the same percentile maths on different bars.
//
//   daily   close-to-close moves, for the real product
//   hourly  hour-to-hour moves, for the intraday demo markets
//
// The hourly one is not optional decoration. A one-hour market carrying the
// daily 1.55% strike would settle BELOW nearly every time, nobody would take
// ABOVE, and the market would void for want of a counterparty. Volatility
// scales with the square root of time, so an hour of a 6.5 hour session moves
// roughly 40% as far as a day. Calibrating on hourly bars puts the base rates
// back where they belong.

import { LOOKBACK_SESSIONS, type Rung } from "../strikes/config";
import { YahooPriceHistoryProvider } from "../strikes/providers/yahoo";
import { todayEastern } from "../strikes/providers/yahoo";
import { takeWindow, toCloseToCloseMoves, validateWindow } from "../strikes/sessions";
import { assertSorted, ladderBps, toBps } from "../strikes/strikes";
import { hourlyCloses } from "./quotes";

export interface Ladder {
  samplesBps: number[];
  strikes: Record<Rung, number>;
  /** Convenience for the single-rung hourly case. */
  strikeBps: number;
}

/**
 * Close-to-close ladder, the product's real calibration.
 *
 * Reuses the Phase 0 pipeline unchanged: same provider, same window
 * validation, same integer percentiles the program re-derives on chain.
 */
export async function dailyLadder(symbol: string): Promise<Ladder> {
  const provider = new YahooPriceHistoryProvider();
  const bars = await provider.dailyCloses({
    ticker: symbol,
    minSessions: LOOKBACK_SESSIONS,
    before: todayEastern(),
  });

  const window = takeWindow(toCloseToCloseMoves(bars), LOOKBACK_SESSIONS);
  validateWindow(symbol, window, LOOKBACK_SESSIONS);

  const samplesBps = window.map((m) => toBps(m.movePct)).sort((a, b) => a - b);
  assertSorted(samplesBps);
  const strikes = ladderBps(samplesBps);

  return { samplesBps, strikes, strikeBps: strikes.fair };
}

/** The ET date of a bar, for deciding which pairs share a session. */
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etMinutes(iso: string): number {
  const parts = ET_CLOCK.formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Keeps only bars from the regular session.
 *
 * The quote source returns pre-market and after-hours bars alongside the
 * regular ones. Those barely move, and leaving them in dragged NVDA's hourly
 * FAIR rung down to 0.12% against a daily 1.55%: eight percent of the daily
 * figure where the square root of time says it should be near forty. A strike
 * that small makes ABOVE win almost every hour, which is the same one-sided
 * market the hourly ladder exists to prevent, arrived at from the other side.
 */
function regularSessionOnly(
  bars: { date: string; close: number }[],
): { date: string; close: number }[] {
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  return bars.filter((bar) => {
    const m = etMinutes(bar.date);
    return m >= OPEN && m < CLOSE;
  });
}

/**
 * Absolute hour-to-hour moves, computed only within a session.
 *
 * The bars arrive as one continuous array, so the last bar of Monday and the
 * first of Tuesday sit next to each other. Measuring across that pair would
 * put the overnight gap into the sample series: a move of daily magnitude
 * wearing an hourly label. At six or seven bars a day that contaminates three
 * of every twenty samples and pushes the WIDE rung up, which is precisely the
 * daily volatility the hourly ladder exists to separate out.
 */
export function intradayMoves(
  symbol: string,
  input: { date: string; close: number }[],
): number[] {
  const bars = regularSessionOnly(input);
  const moves: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];

    if (ET_DATE.format(new Date(prev.date)) !== ET_DATE.format(new Date(curr.date))) {
      continue; // different sessions, so this pair spans the overnight gap
    }

    if (!(prev.close > 0) || !(curr.close > 0)) {
      throw new Error(`${symbol}: non-positive hourly close`);
    }

    const move = (Math.abs(curr.close - prev.close) / prev.close) * 100;
    if (!Number.isFinite(move)) throw new Error(`${symbol}: non-finite hourly move`);
    moves.push(move);
  }

  return moves;
}

/**
 * Hour-to-hour ladder for the intraday markets.
 *
 * Deliberately not validated by `validateWindow`, which asserts one sample
 * per weekday session and would reject six bars a day by construction. The
 * checks that still matter are applied directly: enough bars, all positive,
 * all finite.
 */
export async function hourlyLadder(symbol: string): Promise<Ladder> {
  const bars = await hourlyCloses(symbol, LOOKBACK_SESSIONS);
  const moves = intradayMoves(symbol, bars);

  const samplesBps = moves
    .slice(-LOOKBACK_SESSIONS)
    .map(toBps)
    .sort((a, b) => a - b);

  if (samplesBps.length !== LOOKBACK_SESSIONS) {
    throw new Error(
      `${symbol}: need ${LOOKBACK_SESSIONS} hourly moves, got ${samplesBps.length}`,
    );
  }
  assertSorted(samplesBps);

  const strikes = ladderBps(samplesBps);

  // A zero strike would make every session win ABOVE by default, and the
  // program rejects it anyway. Better to fail here with a readable reason.
  if (strikes.fair < 1) {
    throw new Error(`${symbol}: hourly ladder produced a zero strike`);
  }

  return { samplesBps, strikes, strikeBps: strikes.fair };
}
