// =============================================================================
// Intraday and official-close quotes
// =============================================================================
//
// Two different questions that must not be confused, which is why they are
// separate functions rather than one with a flag:
//
//   liveQuote     what is it trading at right now, for the feed and the UI
//   officialClose what did the session close at, for settlement
//
// Settlement calibrates its strike on official closes. Settling against the
// last intraday tick instead would reintroduce, one level down, exactly the
// definitional mismatch that Phase 0 found between open-to-close and
// close-to-close. Same source, same definition, on both sides.

import { KEEPER_PRICE_EXPONENT } from "./config";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const REQUEST_TIMEOUT_MS = 8_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface Quote {
  /** Scaled to `KEEPER_PRICE_EXPONENT`, which is what the program stores. */
  price: bigint;
  /** Spread across sources, same scale. Zero while there is a single source. */
  conf: bigint;
  /** When the source produced it, never when we read it. */
  publishTime: number;
  sourceCount: number;
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

async function fetchChart(ticker: string, range: string, interval: string) {
  const url = `${CHART_URL}/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);

  const body = (await res.json()) as YahooChart;
  if (body.chart?.error) {
    throw new Error(`${ticker}: ${body.chart.error.description ?? "chart error"}`);
  }
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(`${ticker}: no chart result`);
  return result;
}

/** Float price to the integer scale the program stores. */
export function toScaled(price: number): bigint {
  const factor = 10 ** -KEEPER_PRICE_EXPONENT;
  const scaled = Math.round(price * factor);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error(`price ${price} does not scale to a usable integer`);
  }
  return BigInt(scaled);
}

/**
 * The current trading price.
 *
 * `regularMarketTime` is the source's own timestamp, and it is the value that
 * matters. Outside market hours it stops advancing, which is precisely how
 * the program's staleness check knows to refuse the price rather than settle
 * against a stale one written a second ago.
 */
export async function liveQuote(ticker: string): Promise<Quote> {
  const result = await fetchChart(ticker, "1d", "1m");

  const price = result.meta?.regularMarketPrice;
  const publishTime = result.meta?.regularMarketTime;

  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error(`${ticker}: no usable regularMarketPrice`);
  }
  if (publishTime == null) {
    throw new Error(`${ticker}: quote carries no timestamp, cannot judge staleness`);
  }

  return {
    price: toScaled(price),
    conf: 0n,
    publishTime,
    sourceCount: 1,
  };
}

/**
 * The official close for a session.
 *
 * Distinct from the last intraday tick. The close is set by the closing
 * auction and prints a little after 16:00, so a caller settling on it should
 * run a few minutes past the hour rather than exactly on it.
 */
export async function officialClose(ticker: string, sessionDate: string): Promise<Quote> {
  const result = await fetchChart(ticker, "5d", "1d");

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const etDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  for (let i = timestamps.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    if (etDate.format(new Date(timestamps[i] * 1000)) !== sessionDate) continue;

    return {
      price: toScaled(close),
      conf: 0n,
      publishTime: timestamps[i],
      sourceCount: 1,
    };
  }

  throw new Error(
    `${ticker}: no official close for ${sessionDate}. The auction print can ` +
      `lag the bell by a few minutes; retry rather than settling on an ` +
      `intraday tick.`,
  );
}

/** Intraday bars, for calibrating the hourly strike ladder. */
export async function hourlyCloses(
  ticker: string,
  minBars: number,
): Promise<{ date: string; close: number }[]> {
  // 1h bars over a month comfortably exceeds the 21 closes a 20-bar window
  // needs, even across holidays and half days.
  const result = await fetchChart(ticker, "1mo", "1h");

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const bars: { date: string; close: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date: new Date(timestamps[i] * 1000).toISOString(), close });
  }

  if (bars.length < minBars + 1) {
    throw new Error(
      `${ticker}: need ${minBars + 1} hourly bars, got ${bars.length}`,
    );
  }
  return bars;
}
