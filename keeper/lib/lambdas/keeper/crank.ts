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

import { CalendarCoverageError, easternDate, isTradingDay } from "../shared/calendar";
import { CRANK_GRACE_MINUTES, VOID_GRACE_SECS } from "../shared/config";
import { candidates } from "../shared/candidates";
import { needsPriceUpdate } from "../shared/feed";
import { bn, getProgram, marketPda, priceFeedPda } from "../shared/solana";
import { liveQuote, officialClose } from "../shared/quotes";

const logger = new Logger({ serviceName: "movex-equities-crank" });

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
    priceFeed: { fetch(a: (typeof addresses)[number]): Promise<any> };
  };

  /**
   * The publish time each feed currently carries, read once per ticker and
   * kept current as this run writes to it.
   *
   * Every rung of a ladder shares one feed and locks at the same instant, so
   * without this the second rung would try to write a price the first just
   * wrote and be refused, taking its own lock down with it.
   */
  const feedPublishTimes = new Map<string, number>();
  const feedPublishTime = async (symbol: string): Promise<number> => {
    const cached = feedPublishTimes.get(symbol);
    if (cached !== undefined) return cached;
    const feed = await accounts.priceFeed.fetch(priceFeedPda(program.programId, symbol));
    const ts = Number(feed.publishTime);
    feedPublishTimes.set(symbol, ts);
    return ts;
  };

  const locked: string[] = [];
  const settled: string[] = [];
  const voided: string[] = [];
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
       *
       * The write is skipped when the feed already carries this exact quote.
       * `update_price` demands a strictly newer publish time, so writing a
       * duplicate is refused and the refusal would take the lock or settle
       * bundled with it down too. That is what it did to seven of nine daily
       * markets on 14 September 2026: one rung per ticker went through and
       * the rest never locked.
       */
      const withFreshPrice = async (quote: Awaited<ReturnType<typeof liveQuote>>) => {
        const published = await feedPublishTime(spec.symbol);
        if (!needsPriceUpdate(quote.publishTime, published)) {
          logger.info("feed already carries this quote, not rewriting it", {
            label,
            publishTime: quote.publishTime,
          });
          return [];
        }
        return [
          await program.methods
            .updatePrice(bn(quote.price), bn(quote.conf), bn(quote.publishTime), quote.sourceCount)
            .accounts({
              publisher: program.provider.publicKey!,
              priceFeed: priceFeedPda(program.programId, spec.symbol),
            })
            .instruction(),
        ];
      };

      /** The feed moved forward only if the transaction that wrote it landed. */
      const rememberPublished = (quote: Awaited<ReturnType<typeof liveQuote>>) => {
        const published = feedPublishTimes.get(spec.symbol) ?? 0;
        feedPublishTimes.set(spec.symbol, Math.max(published, quote.publishTime));
      };

      // A daily market settles on the official close, which the auction sets
      // and prints a little after the bell. An hourly one settles mid-session,
      // where the last trade is the right number. Confusing the two would put
      // settlement on a different definition than the strike was calibrated
      // on, which is the mismatch Phase 0 exists to have caught.
      const isDaily = spec.sessionId.length === 10;

      /**
       * A market that ran out of time to resolve.
       *
       * `lock` and `settle` refuse rather than void when they cannot do
       * their job, so a market whose moment passed sits unresolved holding
       * deposits. The program allows anyone to release it once it is far
       * enough past its settle time, but nothing was calling that, so those
       * markets stayed on the board forever showing a state they could
       * never leave. Everyone refunds in full and no fee is taken.
       */
      if ((state === "open" || state === "locked") && now > settleTs + VOID_GRACE_SECS) {
        await program.methods.voidMarket().accounts({ cranker: common.cranker, market: common.market }).rpc();
        logger.warn("voided, it could no longer resolve", { label, settleTs, now });
        voided.push(label);
      } else if (state === "open" && now >= lockTs) {
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
        rememberPublished(quote);
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
        rememberPublished(quote);
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

  logger.info("crank result", { locked, settled, voided, failed, checked: specs.length });
  return { locked, settled, voided, failed };
};
