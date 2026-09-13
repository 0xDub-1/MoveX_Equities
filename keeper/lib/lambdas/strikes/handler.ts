// =============================================================================
// MoveX Equities keeper — compute strikes
// =============================================================================
//
// Runs on a schedule shortly before the US close. Calibrates a strike ladder
// per ticker from the trailing 20 completed sessions and emits it.
//
// Phase 3 extends this handler to call `init_market` on Solana for each rung
// it returns. Until the program exists the report is the output, and
// CloudWatch is the audit trail of what was computed and from which
// sessions.

import { Logger } from "@aws-lambda-powertools/logger";
import { YahooPriceHistoryProvider } from "./providers/yahoo";
import { buildStrikeReport, type StrikeReport } from "./report";

const logger = new Logger({ serviceName: "movex-equities-strikes" });

export const handler = async (): Promise<StrikeReport> => {
  const report = await buildStrikeReport({
    provider: new YahooPriceHistoryProvider(),
  });

  // One structured line per ticker. The window bounds are logged with the
  // strikes so that any threshold we ever settled against can be traced back
  // to the exact sessions it came from.
  for (const [symbol, t] of Object.entries(report.tickers)) {
    logger.info("strike ladder calibrated", {
      symbol,
      session: report.session,
      strikes: t.strikes,
      rungs: t.rungs,
      window: t.window,
      lastClose: t.lastClose,
    });

    for (const warning of t.warnings ?? []) {
      logger.warn("calibration warning", { symbol, warning });
    }
  }

  if (report.errors) {
    // Not fatal on its own. buildStrikeReport throws when every ticker
    // fails, so reaching here means at least one ladder is good.
    logger.error("some tickers failed to calibrate", { errors: report.errors });
  }

  return report;
};
