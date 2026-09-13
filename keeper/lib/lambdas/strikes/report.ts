// =============================================================================
// Strike report
// =============================================================================
//
// Orchestrates a full calibration run: fetch history, derive moves, validate
// the window, compute the ladder, and emit the report.
//
// Deliberately free of any Lambda or AWS dependency so the same code path
// backs both `npm run strikes` on a laptop and the scheduled keeper. The two
// must never drift, because "it worked locally" is not a settlement
// guarantee.

import {
  LOOKBACK_SESSIONS,
  TICKERS,
  type Rung,
  type TickerConfig,
} from "./config";
import type { PriceHistoryProvider } from "./providers/types";
import { todayEastern } from "./providers/yahoo";
import { takeWindow, toCloseToCloseMoves, validateWindow } from "./sessions";
import { assertSorted, bpsToPct, ladderBps, toBps } from "./strikes";

/** Two decimal places, for prices. Strike maths never goes near this. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One session as it appears in the report, for the UI's transparency panel. */
export interface ReportedSession {
  readonly date: string;
  readonly close: number;
  readonly movePct: number;
}

export interface TickerStrikes {
  /**
   * The sorted move series the ladder was read from.
   *
   * Not debug output. This ships to the UI as the public justification for
   * the threshold, which is the difference between "trust our number" and
   * "here are the twenty numbers it came from".
   */
  readonly samples: number[];
  /**
   * The same series in basis points, which is what `init_market` receives.
   *
   * These integers are canonical. `samples` above is a display projection of
   * them, so what the UI shows and what the program verifies can never drift.
   */
  readonly samplesBps: number[];
  readonly strikes: Record<Rung, number>;
  /** Same thresholds in basis points, which is what the program stores. */
  readonly strikesBps: Record<Rung, number>;
  /** Which rungs should be listed as live markets. */
  readonly rungs: readonly Rung[];
  /** The window in chronological order, dates included. */
  readonly sessions: ReportedSession[];
  readonly window: { readonly from: string; readonly to: string; readonly count: number };
  /** Close of the most recent completed session. */
  readonly lastClose: number;
  readonly warnings?: string[];
}

export interface StrikeReport {
  /**
   * The ET trading date this report was calibrated for. The thresholds apply
   * to markets whose reference price is this session's close.
   */
  readonly session: string;
  readonly generatedAt: string;
  readonly provider: string;
  readonly lookback: number;
  readonly tickers: Record<string, TickerStrikes>;
  /** Present only when at least one ticker failed. */
  readonly errors?: Record<string, string>;
}

export interface BuildStrikeReportOptions {
  readonly provider: PriceHistoryProvider;
  readonly tickers?: readonly TickerConfig[];
  readonly lookback?: number;
  /**
   * ET date the run is calibrating for. Sessions on or after it are excluded,
   * so the in-progress session can never enter the window.
   */
  readonly asOf?: string;
  readonly now?: Date;
}

export async function buildStrikeReport(
  opts: BuildStrikeReportOptions,
): Promise<StrikeReport> {
  const {
    provider,
    tickers = TICKERS,
    lookback = LOOKBACK_SESSIONS,
    now = new Date(),
  } = opts;

  const session = opts.asOf ?? todayEastern(now);

  const tickerResults: Record<string, TickerStrikes> = {};
  const errors: Record<string, string> = {};

  // Sequential rather than parallel. Three requests against an unofficial
  // endpoint is not worth the rate-limit risk to save two seconds on a job
  // that runs twice a day.
  for (const cfg of tickers) {
    try {
      tickerResults[cfg.symbol] = await calibrate(provider, cfg, lookback, session);
    } catch (err) {
      errors[cfg.symbol] = err instanceof Error ? err.message : String(err);
    }
  }

  // One broken ticker should not stop the others opening. All of them broken
  // means the provider is down or the shape changed, and that must surface
  // as a failed invocation rather than an empty report that looks fine.
  if (Object.keys(tickerResults).length === 0) {
    throw new Error(
      `strike calibration failed for every ticker: ${JSON.stringify(errors)}`,
    );
  }

  return {
    session,
    generatedAt: now.toISOString(),
    provider: provider.name,
    lookback,
    tickers: tickerResults,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}

async function calibrate(
  provider: PriceHistoryProvider,
  cfg: TickerConfig,
  lookback: number,
  session: string,
): Promise<TickerStrikes> {
  const bars = await provider.dailyCloses({
    ticker: cfg.symbol,
    minSessions: lookback,
    before: session,
  });

  const window = takeWindow(toCloseToCloseMoves(bars), lookback);
  const warnings = validateWindow(cfg.symbol, window, lookback);

  // Basis points first, and everything else derived from them. Rounding each
  // move to an integer before sorting is what lets the program reproduce this
  // exactly: it receives these same integers and recomputes the percentile
  // itself.
  const samplesBps = window.map((m) => toBps(m.movePct)).sort((a, b) => a - b);
  assertSorted(samplesBps);

  const strikesBps = ladderBps(samplesBps);

  return {
    samples: samplesBps.map(bpsToPct),
    samplesBps,
    strikes: {
      tight: bpsToPct(strikesBps.tight),
      fair: bpsToPct(strikesBps.fair),
      wide: bpsToPct(strikesBps.wide),
    },
    strikesBps,
    rungs: cfg.rungs,
    sessions: window.map((m) => ({
      date: m.date,
      close: round2(m.close),
      // Projected through bps so a session's move always matches its entry
      // in the sorted series. Rounding the float separately could show 0.89
      // in one place and 0.88 in the other.
      movePct: bpsToPct(toBps(m.movePct)),
    })),
    window: {
      from: window[0].date,
      to: window[window.length - 1].date,
      count: window.length,
    },
    lastClose: round2(window[window.length - 1].close),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
