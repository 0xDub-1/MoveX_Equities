// =============================================================================
// Crank
// =============================================================================
//
// Locks and settles whatever is due. Runs every minute through the session.
//
// `lock` and `settle` are permissionless in the program, so this is a
// convenience rather than a dependency: if the lambda dies, anyone can push a
// market forward with a short script. That is also the honest answer to a
// centralisation question.
//
// Finds its work by deriving the addresses it expects rather than scanning
// the program's accounts. Every market this keeper creates has a session id
// it can reconstruct, and a targeted `getMultipleAccounts` is both cheaper
// and less fragile than a filtered scan.

import { Logger } from "@aws-lambda-powertools/logger";
import type { Program } from "@coral-xyz/anchor";

import {
  CalendarCoverageError,
  easternDate,
  hourlySlots,
  isTradingDay,
} from "../shared/calendar";
import { CRANK_GRACE_MINUTES, HOURLY_TICKER, PUBLISHED_TICKERS } from "../shared/config";
import { TICKERS } from "../strikes/config";
import { bn, getProgram, marketPda, priceFeedPda } from "../shared/solana";
import { liveQuote, officialClose } from "../shared/quotes";
import type { Tier } from "../shared/markets";

const logger = new Logger({ serviceName: "movex-equities-crank" });

// One source of truth for which rungs each ticker lists: the strike config.
const DAILY_RUNGS: Record<string, Tier[]> = Object.fromEntries(
  TICKERS.map((t) => [t.symbol, [...t.rungs] as Tier[]]),
);

/** How many past sessions to look back for markets still needing a crank. */
const LOOKBACK_DAYS = 4;

interface Candidate {
  symbol: string;
  sessionId: string;
  tier: Tier;
}

function candidates(today: string): Candidate[] {
  const out: Candidate[] = [];

  // Today's hourly slots. Cheap to include all of them: most will already be
  // settled and get skipped on state.
  try {
    for (const slot of hourlySlots(today)) {
      out.push({ symbol: HOURLY_TICKER, sessionId: slot.sessionId, tier: "fair" });
    }
  } catch {
    // Not a trading day, so no hourly slots. Daily markets from previous
    // sessions may still need settling, so this is not fatal.
  }

  // Daily markets are keyed by the date they settle, so looking back a few
  // days catches anything a missed invocation left behind.
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const date = cursor.toISOString().slice(0, 10);
    for (const symbol of PUBLISHED_TICKERS) {
      for (const tier of DAILY_RUNGS[symbol] ?? ["fair"]) {
        out.push({ symbol, sessionId: date, tier });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return out;
}

export const handler = async () => {
  const today = easternDate();

  try {
    // A market can still need settling on a day with no session, so this is
    // logged rather than used to bail out.
    if (!isTradingDay(today)) logger.info("not a session, checking for leftovers", { today });
  } catch (err) {
    if (!(err instanceof CalendarCoverageError)) throw err;
    logger.warn("calendar does not cover today", { today });
  }

  const program = await getProgram();
  const now = Math.floor(Date.now() / 1000);
  const graceSecs = CRANK_GRACE_MINUTES * 60;

  const specs = candidates(today);
  const addresses = specs.map((s) => marketPda(program.programId, s.symbol, s.sessionId, s.tier));

  const infos = await program.provider.connection.getMultipleAccountsInfo(addresses);
  const accounts = program.account as unknown as {
    market: { coder: unknown; fetch(a: (typeof addresses)[number]): Promise<any> };
  };

  const locked: string[] = [];
  const settled: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < specs.length; i++) {
    if (!infos[i]) continue; // never created, nothing to do

    const spec = specs[i];
    const label = `${spec.symbol}/${spec.sessionId}/${spec.tier}`;

    try {
      const market = await accounts.market.fetch(addresses[i]);
      const state = Object.keys(market.state)[0];
      const lockTs = Number(market.lockTs);
      const settleTs = Number(market.settleTs);

      const common = {
        cranker: program.provider.publicKey!,
        market: addresses[i],
        priceFeed: priceFeedPda(program.programId, spec.symbol),
      };

      /**
       * Publishes the price in the same transaction that consumes it.
       *
       * Without this the reference is whatever the publisher last wrote, up
       * to a minute old, on top of however late the crank itself is. Bundling
       * removes the feed-age term entirely: the price is zero seconds old by
       * construction, leaving only the crank's own scheduling delay.
       *
       * It is also how Pyth's pull oracle is meant to be used, so this moves
       * toward the mainnet design rather than away from it.
       */
      const withFreshPrice = async (quote: Awaited<ReturnType<typeof liveQuote>>) => [
        await program.methods
          .updatePrice(bn(quote.price), bn(quote.conf), bn(quote.publishTime), quote.sourceCount)
          .accounts({
            publisher: program.provider.publicKey!,
            priceFeed: priceFeedPda(program.programId, spec.symbol),
          })
          .instruction(),
      ];

      // A daily market settles on the official close, which the auction sets
      // and prints a little after the bell. An hourly one settles mid-session,
      // where the last trade is the right number. Confusing the two would put
      // settlement on a different definition than the strike was calibrated
      // on, which is the mismatch Phase 0 exists to have caught.
      const isDaily = spec.sessionId.length === 10;

      if (state === "open" && now >= lockTs) {
        // Past the grace window the reference price would be taken far enough
        // from the intended instant that it is no longer the price the market
        // was sold on. Leaving it to void is the honest outcome.
        if (now > lockTs + graceSecs) {
          logger.warn("too late to lock, leaving it to void", { label, lockTs, now });
          continue;
        }
        // The reference is always the live price: the deposit window just
        // closed and the market starts measuring from here, whatever kind it
        // is.
        const quote = await liveQuote(spec.symbol);
        await program.methods
          .lock()
          .accounts(common)
          .preInstructions(await withFreshPrice(quote))
          .rpc();
        logger.info("locked", { label, price: quote.price.toString() });
        locked.push(label);
      } else if (state === "locked" && now >= settleTs) {
        if (now > settleTs + graceSecs) {
          logger.warn("too late to settle, leaving it to void", { label, settleTs, now });
          continue;
        }

        const quote = isDaily
          ? await officialClose(spec.symbol, spec.sessionId)
          : await liveQuote(spec.symbol);

        await program.methods
          .settle()
          .accounts(common)
          .preInstructions(await withFreshPrice(quote))
          .rpc();
        logger.info("settled", { label, price: quote.price.toString(), isDaily });
        settled.push(label);
      }
    } catch (err) {
      // Expected on any tick where the price is stale: the program refuses
      // rather than settling against an old number, and the next tick retries.
      logger.warn("crank failed, will retry next tick", {
        label,
        error: err instanceof Error ? err.message : String(err),
      });
      failed.push(label);
    }
  }

  logger.info("crank result", { locked, settled, failed, checked: specs.length });
  return { locked, settled, failed };
};
