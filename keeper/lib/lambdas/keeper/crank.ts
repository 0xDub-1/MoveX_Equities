// =============================================================================
// Crank, equities
// =============================================================================
//
// Locks and settles whatever is due. Runs every minute through the session.
// The loop lives in `shared/crank-run.ts`, shared with the crypto venue; this
// file decides which markets to look at and where their prices come from.

import { Logger } from "@aws-lambda-powertools/logger";

import { CalendarCoverageError, easternDate, isTradingDay } from "../shared/calendar";
import { candidates } from "../shared/candidates";
import { runCrank, type CrankSpec } from "../shared/crank-run";
import { liveQuote, officialClose } from "../shared/quotes";

const logger = new Logger({ serviceName: "movex-equities-crank" });

/**
 * A daily market settles on the official close, which the auction sets and
 * prints a little after the bell. An hourly one settles mid-session, where
 * the last trade is the right number. Confusing the two would put settlement
 * on a different definition than the strike was calibrated on, which is the
 * mismatch Phase 0 exists to have caught.
 *
 * The reference is always the live price: the deposit window just closed and
 * the market starts measuring from here, whatever kind it is.
 */
async function quoteFor(spec: CrankSpec, phase: "lock" | "settle") {
  const isDaily = spec.sessionId.length === 10;
  if (phase === "settle" && isDaily) return officialClose(spec.symbol, spec.sessionId);
  return liveQuote(spec.symbol);
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

  return runCrank({ specs: candidates(today), quoteFor, logger });
};
