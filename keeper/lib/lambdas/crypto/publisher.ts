// =============================================================================
// Price publisher, crypto
// =============================================================================
//
// Writes the current Hyperliquid mid into each crypto asset's PriceFeed
// account. Runs every minute, around the clock: there is no session to be
// outside of.
//
// One `allMids` call covers every listed asset, so listing a new one costs
// no extra request. The response carries no timestamp, so the publish time
// is the moment it was read, which is what the program's staleness check
// measures from.

import { Logger } from "@aws-lambda-powertools/logger";

import { CRYPTO_ASSETS, coinOf } from "../shared/crypto-config";
import { allMids, midToQuote } from "../shared/hyperliquid";
import { bn, getProgram, priceFeedPda } from "../shared/solana";

const logger = new Logger({ serviceName: "movex-crypto-publisher" });

export const handler = async (): Promise<{ published: string[]; skipped: string[] }> => {
  const symbols = CRYPTO_ASSETS.map((a) => a.symbol);

  let mids: Record<string, string>;
  try {
    mids = await allMids();
  } catch (err) {
    // The one call every asset depends on. Nothing to write this minute;
    // the next tick asks again.
    logger.error("allMids failed, nothing published this tick", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { published: [], skipped: symbols };
  }
  const nowSec = Math.floor(Date.now() / 1000);

  const program = await getProgram();
  const published: string[] = [];
  const skipped: string[] = [];

  // Sequential, and each asset isolated. One symbol failing must not stop
  // the others: a feed that misses a minute is fine, a feed that misses an
  // hour because a sibling threw is not.
  for (const asset of CRYPTO_ASSETS) {
    const symbol = asset.symbol;
    try {
      const quote = midToQuote(mids[coinOf(symbol)], nowSec, coinOf(symbol));
      const feed = priceFeedPda(program.programId, symbol);

      // The program requires each price to be strictly newer than the last.
      // The crank may have written this very second while locking a market.
      const accounts = program.account as unknown as {
        priceFeed: { fetch(address: typeof feed): Promise<{ publishTime: bigint | number }> };
      };
      const current = await accounts.priceFeed.fetch(feed).catch(() => null);
      if (current && Number(current.publishTime) >= quote.publishTime) {
        logger.debug("feed already carries a price for this second", { symbol });
        skipped.push(symbol);
        continue;
      }

      await program.methods
        .updatePrice(bn(quote.price), bn(quote.conf), bn(quote.publishTime), quote.sourceCount)
        .accounts({
          publisher: program.provider.publicKey!,
          priceFeed: feed,
        })
        .rpc();

      logger.info("published", { symbol, price: quote.price.toString(), publishTime: quote.publishTime });
      published.push(symbol);
    } catch (err) {
      logger.error("failed to publish", {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped.push(symbol);
    }
  }

  if (published.length === 0) logger.warn("nothing published this tick", { skipped });

  return { published, skipped };
};
