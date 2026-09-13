// =============================================================================
// Yahoo Finance price history provider
// =============================================================================
//
// Selected in Phase 0 after Pyth Benchmarks turned out to be $500/month with
// no free tier, and Stooq started serving a JavaScript proof-of-work
// challenge. Yahoo's chart endpoint needs no key and no signup, and we make
// three requests per day in total.
//
// It is an unofficial endpoint. That is an accepted risk, bounded by the
// PriceHistoryProvider interface: if it breaks, only this file changes.

import type { DailyBar, HistoryRequest, PriceHistoryProvider } from "./types";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Three months of daily bars is roughly 63 sessions. Comfortably more than
 * the 21 closes a 20-session window needs, even across a holiday-heavy
 * stretch, and the payload is still small.
 */
const RANGE = "3mo";

const REQUEST_TIMEOUT_MS = 10_000;

/** Yahoo rejects requests without a browser-shaped User-Agent. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export class YahooPriceHistoryProvider implements PriceHistoryProvider {
  readonly name = "yahoo";

  async dailyCloses(req: HistoryRequest): Promise<DailyBar[]> {
    const url = `${CHART_URL}/${encodeURIComponent(req.ticker)}?interval=1d&range=${RANGE}`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`${req.ticker}: Yahoo returned HTTP ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as YahooChartResponse;

    if (body.chart?.error) {
      const { code, description } = body.chart.error;
      throw new Error(`${req.ticker}: Yahoo error ${code ?? "unknown"}: ${description ?? ""}`);
    }

    const result = body.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;

    if (!timestamps?.length || !closes?.length) {
      throw new Error(`${req.ticker}: Yahoo returned no bars`);
    }

    const bars: DailyBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      const ts = timestamps[i];

      // Yahoo pads the arrays with nulls for halted or missing sessions.
      // A bar without a close tells us nothing, so it is dropped rather
      // than interpolated. Interpolating would invent a move.
      if (close == null || !Number.isFinite(close) || close <= 0) continue;
      if (ts == null) continue;

      const date = easternDate(ts);

      // Drop the in-progress session, and anything after the cutoff.
      if (date >= req.before) continue;

      bars.push({ date, close });
    }

    bars.sort((a, b) => a.date.localeCompare(b.date));

    // N moves need N+1 closes.
    const required = req.minSessions + 1;
    if (bars.length < required) {
      throw new Error(
        `${req.ticker}: need ${required} closes before ${req.before}, Yahoo supplied ${bars.length}`,
      );
    }

    return bars;
  }
}

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Epoch seconds to the `YYYY-MM-DD` date of that instant in US Eastern.
 *
 * Yahoo stamps daily bars at the exchange open, so a naive UTC conversion
 * happens to agree today. It would stop agreeing the moment a bar is
 * stamped differently, and a silently shifted date corrupts the window
 * without failing anything, so we ask for Eastern explicitly.
 *
 * `en-CA` is used because it formats as `YYYY-MM-DD`, which sorts
 * lexicographically.
 */
export function easternDate(epochSeconds: number): string {
  return ET_DATE_FORMAT.format(new Date(epochSeconds * 1000));
}

/** Today's date in US Eastern, as `YYYY-MM-DD`. */
export function todayEastern(now: Date = new Date()): string {
  return ET_DATE_FORMAT.format(now);
}
