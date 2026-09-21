// =============================================================================
// Hyperliquid: quotes and candles for the crypto venue
// =============================================================================
//
// Two questions, two endpoints, one host:
//
//   allMids          what everything is trading at right now, one call
//   candleSnapshot   closed bars, for calibrating a ladder
//
// The mid is what lock and settle record and what the ladder is calibrated
// on, so the strike and the settlement are read from the same tape. Mixing a
// spot index into one and a perp mid into the other would put a basis into
// every market that nobody priced.
//
// `startTime` is mandatory on candleSnapshot. Without it the server answers
// 422 "Failed to deserialize the JSON body", which reads like a malformed
// request rather than a missing field. `endTime` defaults to now.

import { LOOKBACK_SESSIONS, type Rung } from "../strikes/config";
import { assertSorted, ladderBps, toBps } from "../strikes/strikes";
import { toScaled, type Quote } from "./quotes";

export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const REQUEST_TIMEOUT_MS = 8_000;

export type CandleInterval = "1h" | "1d";

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/** One bar, numbers parsed. `t` opens it and `T` is its last millisecond. */
export interface Candle {
  t: number;
  T: number;
  o: number;
  h: number;
  l: number;
  c: number;
  n: number;
}

export interface Ladder {
  samplesBps: number[];
  strikes: Record<Rung, number>;
  /** The rung an hourly market carries. */
  strikeBps: number;
}

async function info<T>(body: unknown): Promise<T> {
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`hyperliquid: HTTP ${res.status}${text ? ` ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Every coin's mid, as the strings the API sends. */
export async function allMids(): Promise<Record<string, string>> {
  const mids = await info<Record<string, string>>({ type: "allMids" });
  if (!mids || typeof mids !== "object") throw new Error("hyperliquid: allMids is not an object");
  return mids;
}

/**
 * A mid as the feed stores it.
 *
 * The response carries no timestamp, so the publish time is the moment it was
 * read. That is honest: a mid is the state of the book when it was asked for,
 * and the program's staleness check measures from there.
 */
export function midToQuote(mid: string | undefined, nowSec: number, coin = "?"): Quote {
  if (mid === undefined) throw new Error(`hyperliquid: no mid for ${coin}`);
  const price = Number(mid);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`hyperliquid: unusable mid for ${coin}: ${mid}`);
  }
  return { price: toScaled(price), conf: 0n, publishTime: nowSec, sourceCount: 1 };
}

/** Quotes for several coins from one call, keyed by coin. */
export async function midQuotes(
  coins: readonly string[],
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Map<string, Quote>> {
  const mids = await allMids();
  const out = new Map<string, Quote>();
  for (const coin of coins) out.set(coin, midToQuote(mids[coin], nowSec, coin));
  return out;
}

interface RawCandle {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  n: number;
}

function parseCandle(raw: RawCandle): Candle {
  const candle = {
    t: Number(raw.t),
    T: Number(raw.T),
    o: Number(raw.o),
    h: Number(raw.h),
    l: Number(raw.l),
    c: Number(raw.c),
    n: Number(raw.n),
  };
  for (const [k, v] of Object.entries(candle)) {
    if (!Number.isFinite(v)) throw new Error(`hyperliquid: candle field ${k} is not a number`);
  }
  return candle;
}

/**
 * The last `count` bars of `interval`, oldest first, the running one included.
 *
 * Asks for two more than it needs so a bar the server has not closed yet, or
 * one it is missing, still leaves enough behind it.
 */
export async function candles(
  coin: string,
  interval: CandleInterval,
  count: number,
  nowMs = Date.now(),
): Promise<Candle[]> {
  const span = (count + 2) * INTERVAL_MS[interval];
  const raw = await info<RawCandle[]>({
    type: "candleSnapshot",
    req: { coin, interval, startTime: nowMs - span, endTime: nowMs },
  });
  if (!Array.isArray(raw)) throw new Error(`hyperliquid: candleSnapshot for ${coin} is not a list`);
  return raw.map(parseCandle).sort((a, b) => a.t - b.t);
}

/**
 * Only bars that have closed. The last bar the server returns is the one in
 * progress, with a close that is really the last print. Calibrating on it
 * would read a threshold off a number that never existed as a close.
 */
export function closedCandles(bars: readonly Candle[], nowMs: number): Candle[] {
  return bars.filter((c) => c.T < nowMs);
}

/**
 * Absolute close-to-close moves in basis points, over consecutive bars only.
 *
 * A pair further apart than one interval is a missing bar, and measuring
 * across it would put a two-hour move into a series of hourly ones. The pair
 * is dropped, as the equities ladder drops the overnight gap.
 */
export function movesBps(bars: readonly Candle[], interval: CandleInterval): number[] {
  const step = INTERVAL_MS[interval];
  const moves: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    if (curr.t - prev.t !== step) continue;
    if (!(prev.c > 0) || !(curr.c > 0)) throw new Error("hyperliquid: non-positive close");
    const pct = (Math.abs(curr.c - prev.c) / prev.c) * 100;
    if (!Number.isFinite(pct)) throw new Error("hyperliquid: non-finite move");
    moves.push(toBps(pct));
  }
  return moves;
}

/**
 * The ladder the last twenty closed bars imply, with the same integer
 * percentiles the program re-derives on chain.
 */
export function ladderFromCandles(
  bars: readonly Candle[],
  interval: CandleInterval,
  nowMs: number,
  lookback = LOOKBACK_SESSIONS,
): Ladder {
  const closed = closedCandles(bars, nowMs);
  const moves = movesBps(closed, interval);
  if (moves.length < lookback) {
    throw new Error(`hyperliquid: need ${lookback} ${interval} moves, got ${moves.length}`);
  }
  const samplesBps = moves.slice(-lookback).sort((a, b) => a - b);
  assertSorted(samplesBps);
  const strikes = ladderBps(samplesBps);
  return { samplesBps, strikes, strikeBps: strikes.fair };
}

/** Fetches and calibrates in one call. */
export async function cryptoLadder(
  coin: string,
  interval: CandleInterval,
  nowMs = Date.now(),
): Promise<Ladder> {
  const bars = await candles(coin, interval, LOOKBACK_SESSIONS + 3, nowMs);
  return ladderFromCandles(bars, interval, nowMs);
}
