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
  nextTradingDay,
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

/** 09:00 ET. Creates every hourly market the session can carry. */
export const hourlyHandler = async () => {
  const date = sessionToday();
  if (!date) return { created: [], existing: [], failed: [] };

  const program = await getProgram();
  const ladder = await hourlyLadder(HOURLY_TICKER);

  const specs = hourlySpecs(date, HOURLY_TICKER, ladder.strikeBps, ladder.samplesBps);
  logger.info("hourly markets for the session", {
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

/** 15:55 ET. Creates the markets that lock at today's close. */
export const dailyHandler = async () => {
  const date = sessionToday();
  if (!date) return { created: [], existing: [], failed: [] };

  const program = await getProgram();

  // Locks at today's close, settles at the next session's close. Deposits
  // have been open since this ran yesterday, so the window is a full day.
  const settleDate = nextTradingDay(date);

  const specs: MarketSpec[] = [];
  for (const symbol of PUBLISHED_TICKERS) {
    try {
      const ladder = await dailyLadder(symbol);
      for (const tier of DAILY_RUNGS[symbol] ?? ["fair"]) {
        specs.push(
          dailySpec(date, settleDate, symbol, tier, ladder.strikes[tier], ladder.samplesBps),
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

  logger.info("daily markets", { lockDate: date, settleDate, count: specs.length });

  const result = await ensureMarkets(
    program,
    quoteMint(),
    treasury(program.provider.publicKey!),
    specs,
  );
  logger.info("daily result", result);
  return result;
};
