// =============================================================================
// Market creation lambdas
// =============================================================================
//
// Two handlers sharing one file because they differ only in which clock they
// answer to and which ladder they calibrate on.
//
//   hourly  09:00 ET   the day's intraday markets, all of them at once
//   daily   15:55 ET   tomorrow's close-to-close markets
//
// Creating a market needs no price, only locking one does, which is why the
// hourly handler can run an hour before the bell.

import { Logger } from "@aws-lambda-powertools/logger";
import { PublicKey } from "@solana/web3.js";

import {
  CalendarCoverageError,
  easternDate,
  isTradingDay,
  dailyMarketDates,
  nextTradingDay,
  type DailyTarget,
} from "../shared/calendar";
import { HOURLY_TICKER, PUBLISHED_TICKERS } from "../shared/config";
import { TICKERS } from "../strikes/config";
import { dailySpec, ensureMarkets, hourlySpecs, type MarketSpec, type Tier } from "../shared/markets";
import { getProgram } from "../shared/solana";
import { hourlyLadder, dailyLadder } from "../shared/ladders";

const logger = new Logger({ serviceName: "movex-equities-markets" });

// One source of truth for which rungs each ticker lists: the strike config.
const DAILY_RUNGS: Record<string, Tier[]> = Object.fromEntries(
  TICKERS.map((t) => [t.symbol, [...t.rungs] as Tier[]]),
);

function quoteMint(): PublicKey {
  const value = process.env.QUOTE_MINT;
  if (!value) {
    // Not derivable from anything: the USDX mint is a generated keypair, so
    // it has to be handed in rather than computed.
    throw new Error("QUOTE_MINT is not set");
  }
  return new PublicKey(value);
}

function treasury(fallback: PublicKey): PublicKey {
  return process.env.TREASURY ? new PublicKey(process.env.TREASURY) : fallback;
}

/** Returns null when today is not a session, or the calendar cannot say. */
function sessionToday(): string | null {
  const date = easternDate();
  try {
    if (!isTradingDay(date)) {
      logger.info("not a trading day", { date });
      return null;
    }
    return date;
  } catch (err) {
    if (err instanceof CalendarCoverageError) {
      // Fail closed. Creating markets on a day that turns out to be a
      // holiday leaves deposits locked until the void grace period, which is
      // recoverable but ugly; creating none is merely a missed day.
      logger.error("calendar cannot vouch for today, creating nothing", {
        date,
        error: err.message,
      });
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------

/** Which session an hourly run creates markets for. */
type HourlyTarget = "today" | "next";

interface HourlyEvent {
  session?: HourlyTarget;
}

/** Which ladder a daily run creates. `DailyTarget` lives with the calendar. */
interface DailyEvent {
  session?: DailyTarget;
}

/**
 * The session a run targets, or null when there is nothing to create.
 *
 * Both targets require today to be a session, so markets are only ever
 * created on trading days. That keeps the hourly runs consistent with the
 * daily one rather than having a holiday produce intraday markets and no
 * ladder.
 */
function targetSession(target: HourlyTarget): string | null {
  const today = sessionToday();
  if (!today || target === "today") return today;

  try {
    return nextTradingDay(today);
  } catch (err) {
    if (err instanceof CalendarCoverageError) {
      logger.error("calendar cannot name the next session, creating nothing", {
        today,
        error: err.message,
      });
      return null;
    }
    throw err;
  }
}

/**
 * Creates one session's hourly markets.
 *
 * The run that matters is at 15:55 with `session: "next"`, alongside the
 * daily ladder, so the first hour of tomorrow opens for deposits the evening
 * before instead of sixty minutes ahead of its lock. The 09:00 run passes
 * `session: "today"` and is a backstop: when the evening run did its job it
 * finds every market already there and creates nothing.
 */
export const hourlyHandler = async (event?: HourlyEvent) => {
  const target: HourlyTarget = event?.session === "next" ? "next" : "today";
  const date = targetSession(target);
  if (!date) return { created: [], existing: [], failed: [] };

  const program = await getProgram();
  const ladder = await hourlyLadder(HOURLY_TICKER);

  const specs = hourlySpecs(date, HOURLY_TICKER, ladder.strikeBps, ladder.samplesBps);
  logger.info("hourly markets for the session", {
    target,
    date,
    count: specs.length,
    strikeBps: ladder.strikeBps,
    // Three instead of six means a half day was detected. Worth seeing.
    halfDay: specs.length < 6,
  });

  const result = await ensureMarkets(
    program,
    quoteMint(),
    treasury(program.provider.publicKey!),
    specs,
  );
  logger.info("hourly result", result);
  return result;
};

/**
 * Creates one daily ladder.
 *
 * The run that matters is at 15:55 with `session: "next"`: the ladder locks
 * at the next session's close and settles the one after, so the deposit
 * window is about a day. The 09:00 run passes `session: "today"` and is a
 * backstop for the ladder the previous session should have created, which
 * locks at today's close.
 *
 * The backstop exists because one market failing is not one market lost. A
 * send that drops takes that rung off the board for the whole session, and
 * before this there was nothing that ever looked again.
 */
export const dailyHandler = async (event?: DailyEvent) => {
  const target: DailyTarget = event?.session === "today" ? "today" : "next";
  const date = sessionToday();
  if (!date) return { created: [], existing: [], failed: [] };

  const program = await getProgram();

  const { lockDate, settleDate } = dailyMarketDates(date, target);

  const specs: MarketSpec[] = [];
  for (const symbol of PUBLISHED_TICKERS) {
    try {
      const ladder = await dailyLadder(symbol);
      for (const tier of DAILY_RUNGS[symbol] ?? ["fair"]) {
        specs.push(
          dailySpec(lockDate, settleDate, symbol, tier, ladder.strikes[tier], ladder.samplesBps),
        );
      }
    } catch (err) {
      // One ticker without a ladder must not cost the others their markets.
      logger.error("no ladder, skipping ticker", {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("daily markets", { target, createdOn: date, lockDate, settleDate, count: specs.length });

  const result = await ensureMarkets(
    program,
    quoteMint(),
    treasury(program.provider.publicKey!),
    specs,
  );
  logger.info("daily result", result);
  return result;
};
