// =============================================================================
// Price publisher
// =============================================================================
//
// Writes the current price into each ticker's PriceFeed account. Runs every
// minute while the NYSE is open.
//
// This is the whole devnet oracle. Pyth moved Hermes behind a $500/month key
// in August 2026, so until that is affordable the chain reads prices we put
// there. The account is shaped like a Pyth sponsored feed so the program and
// the frontend read it identically, and so swapping back is one file.

import { Logger } from "@aws-lambda-powertools/logger";

import {
  easternDate,
  easternMinutes,
  closeMinutes,
  isTradingDay,
  OPEN_MINUTES,
  CalendarCoverageError,
} from "../shared/calendar";
import { PUBLISHED_TICKERS } from "../shared/config";
import { liveQuote } from "../shared/quotes";
import { getProgram, priceFeedPda } from "../shared/solana";

const logger = new Logger({ serviceName: "movex-equities-publisher" });

/** A few minutes either side, so the open and close ticks are not missed. */
const EDGE_SLACK_MINUTES = 5;

export const handler = async (): Promise<{ published: string[]; skipped: string[] }> => {
  const now = new Date();
  const date = easternDate(now);

  let tradingDay: boolean;
  try {
    tradingDay = isTradingDay(date);
  } catch (err) {
    if (err instanceof CalendarCoverageError) {
      // Refusing to publish is the safe failure. A price written on a day the
      // calendar cannot vouch for is worse than no price, because the
      // program's staleness check only catches an old price, not a wrong one.
      logger.error("calendar does not cover today, not publishing", {
        date,
        error: err.message,
      });
      return { published: [], skipped: [...PUBLISHED_TICKERS] };
    }
    throw err;
  }

  if (!tradingDay) {
    logger.info("not a trading day, nothing to publish", { date });
    return { published: [], skipped: [...PUBLISHED_TICKERS] };
  }

  const minutes = easternMinutes(now);
  const close = closeMinutes(date);
  if (minutes < OPEN_MINUTES - EDGE_SLACK_MINUTES || minutes > close + EDGE_SLACK_MINUTES) {
    logger.info("outside the session", { date, minutes, close });
    return { published: [], skipped: [...PUBLISHED_TICKERS] };
  }

  const program = await getProgram();
  const published: string[] = [];
  const skipped: string[] = [];

  // Sequential, and each ticker isolated. One symbol failing must not stop
  // the others: a feed that misses a minute is fine, a feed that misses an
  // hour because a sibling threw is not.
  for (const ticker of PUBLISHED_TICKERS) {
    try {
      const quote = await liveQuote(ticker);
      const feed = priceFeedPda(program.programId, ticker);

      // The program requires each price to be strictly newer than the last.
      // Re-publishing an unchanged quote is not an error worth alarming on:
      // outside active trading the source simply has nothing new to say.
      // `Program<Idl>` cannot know account names from a JSON IDL, so the
      // namespace is untyped here. Narrowed to the one field that is read.
      const accounts = program.account as unknown as {
        priceFeed: { fetch(address: typeof feed): Promise<{ publishTime: bigint | number }> };
      };
      const current = await accounts.priceFeed.fetch(feed).catch(() => null);
      if (current && Number(current.publishTime) >= quote.publishTime) {
        logger.debug("source has not moved since the last write", {
          ticker,
          publishTime: quote.publishTime,
        });
        skipped.push(ticker);
        continue;
      }

      await program.methods
        .updatePrice(
          quote.price,
          quote.conf,
          quote.publishTime,
          quote.sourceCount,
        )
        .accounts({
          publisher: program.provider.publicKey!,
          priceFeed: feed,
        })
        .rpc();

      logger.info("published", {
        ticker,
        price: quote.price.toString(),
        publishTime: quote.publishTime,
        ageSecs: Math.floor(Date.now() / 1000) - quote.publishTime,
      });
      published.push(ticker);
    } catch (err) {
      logger.error("failed to publish", {
        ticker,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped.push(ticker);
    }
  }

  // Every ticker failing points at the provider or the signer rather than at
  // one symbol, and should surface as a failed invocation.
  if (published.length === 0 && skipped.length === PUBLISHED_TICKERS.length) {
    logger.warn("nothing published this tick", { date, minutes });
  }

  return { published, skipped };
};
