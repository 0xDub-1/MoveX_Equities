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

  const moves: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (!(prev > 0) || !(curr > 0)) {
      throw new Error(`${symbol}: non-positive hourly close`);
    }
    const move = (Math.abs(curr - prev) / prev) * 100;
    if (!Number.isFinite(move)) throw new Error(`${symbol}: non-finite hourly move`);
    moves.push(move);
  }

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
