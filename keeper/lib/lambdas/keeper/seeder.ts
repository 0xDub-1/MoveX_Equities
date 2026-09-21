// =============================================================================
// Seeder, equities
// =============================================================================
//
// Devnet only. Keeps every open equities market funded on both sides and
// claims what the seed wallets have won, so markets resolve instead of
// voiding and every instruction in the lifecycle runs against the chain each
// day. The run itself lives in `shared/seed-run.ts`, where the crypto venue
// uses it too; this file decides which markets and which wallets.
//
// Equities spend the first block of derived wallets. Crypto has its own
// block, so one venue running its allowance down never leaves the other's
// markets one-sided.

import { Logger } from "@aws-lambda-powertools/logger";

import { CalendarCoverageError, easternDate, isTradingDay } from "../shared/calendar";
import { candidates } from "../shared/candidates";
import { runSeeder } from "../shared/seed-run";
import { seedWalletIndices } from "../shared/seeding";

const logger = new Logger({ serviceName: "movex-equities-seeder" });

export const handler = async () => {
  const today = easternDate();
  try {
    if (!isTradingDay(today)) {
      logger.info("not a trading day", { today });
      return { deposited: [], claimed: [] };
    }
  } catch (err) {
    if (!(err instanceof CalendarCoverageError)) throw err;
    logger.error("calendar cannot vouch for today", { today });
    return { deposited: [], claimed: [] };
  }
  return seedMarkets(today);
};

/**
 * Funds both sides of every market `candidates(today)` names and claims what
 * the seed wallets have won.
 *
 * The handler gates this on a trading day. The local script does not, which
 * is how the next session's markets get their seed over a weekend: the
 * candidates for a Saturday already include Monday's hours and the ladder
 * that locks at Monday's close.
 */
export async function seedMarkets(
  today: string,
): Promise<{ deposited: string[]; claimed: string[] }> {
  return runSeeder({
    specs: candidates(today),
    walletIndices: seedWalletIndices("equities"),
    logger,
  });
}
