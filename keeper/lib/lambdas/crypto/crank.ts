// =============================================================================
// Crank, crypto
// =============================================================================
//
// Locks and settles whatever is due among the crypto markets. Runs every
// minute, around the clock. The loop lives in `shared/crank-run.ts`; this
// file decides which markets to look at and where their prices come from.
//
// Both lock and settle record the Hyperliquid mid, the same tape the ladder
// was calibrated on. There is no closing auction to wait for: a daily market
// settles on the mid at midnight UTC exactly as an hourly one settles on the
// mid at the top of the hour.

import { Logger } from "@aws-lambda-powertools/logger";

import { runCrank, type CrankSpec } from "../shared/crank-run";
import { coinOf } from "../shared/crypto-config";
import { allMids, midToQuote } from "../shared/hyperliquid";
import type { Quote } from "../shared/quotes";
import { cryptoCandidates } from "../shared/utc-sessions";

const logger = new Logger({ serviceName: "movex-crypto-crank" });

/**
 * How old a mid may be before it is fetched again within one run. Three
 * rungs of a ladder lock together and should read one price, not three a
 * second apart; a run that drags on should not settle on a stale one.
 */
const MIDS_MAX_AGE_SECS = 15;

/** One `allMids` per few seconds, whatever the number of markets. */
function midSource(): (spec: CrankSpec) => Promise<Quote> {
  let mids: Record<string, string> | null = null;
  let readAt = 0;
  return async (spec) => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!mids || nowSec - readAt > MIDS_MAX_AGE_SECS) {
      mids = await allMids();
      readAt = nowSec;
    }
    return midToQuote(mids[coinOf(spec.symbol)], readAt, coinOf(spec.symbol));
  };
}

export const handler = async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const quote = midSource();
  return runCrank({
    specs: cryptoCandidates(nowSec),
    quoteFor: (spec) => quote(spec),
    logger,
  });
};
