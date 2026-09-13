#!/usr/bin/env ts-node
// =============================================================================
// npm run strikes
// =============================================================================
//
// Phase 0 exit criteria: print a real strike ladder plus the full session
// series for every configured ticker, computed from live historical data.
//
// Runs the exact code path the scheduled keeper runs. The only difference is
// the formatting of the output, so a green run here is evidence about the
// keeper and not just about this script.
//
//   npm run strikes            human-readable
//   npm run strikes -- --json  the raw report contract
//
// This is a CLI, so stdout is the product and console is the right sink.
// Lambda logging goes through Powertools in handler.ts.
/* eslint-disable no-console */

import { YahooPriceHistoryProvider } from "../lib/lambdas/strikes/providers/yahoo";
import { buildStrikeReport, type StrikeReport } from "../lib/lambdas/strikes/report";

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");

  const report = await buildStrikeReport({
    provider: new YahooPriceHistoryProvider(),
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  // A partial run is a real failure even though some ladders came back, so
  // it must not exit 0 and look green in CI.
  if (report.errors) {
    console.error(`\nFAILED for ${Object.keys(report.errors).join(", ")}`);
    for (const [symbol, message] of Object.entries(report.errors)) {
      console.error(`  ${symbol}: ${message}`);
    }
    process.exitCode = 1;
  }
}

function printReport(report: StrikeReport): void {
  console.log(`\nMoveX Equities — strike calibration`);
  console.log(`session ${report.session}   provider ${report.provider}   lookback ${report.lookback}\n`);

  for (const [symbol, t] of Object.entries(report.tickers)) {
    console.log(`${"=".repeat(72)}`);
    console.log(`${symbol}   last close ${t.lastClose}   window ${t.window.from} -> ${t.window.to} (${t.window.count} sessions)`);
    console.log(`${"=".repeat(72)}`);

    console.log(`\n  sessions (chronological)`);
    for (const s of t.sessions) {
      console.log(`    ${s.date}   close ${pad(s.close.toFixed(2), 9)}   move ${pad(s.movePct.toFixed(2), 6)}%`);
    }

    console.log(`\n  sorted move series`);
    console.log(`    ${t.samples.map((v) => v.toFixed(2)).join("  ")}`);

    console.log(`\n  ladder`);
    console.log(`    TIGHT (P25)   ${pad(t.strikes.tight.toFixed(2), 6)}%   ${listed(t, "tight")}`);
    console.log(`    FAIR  (P50)   ${pad(t.strikes.fair.toFixed(2), 6)}%   ${listed(t, "fair")}`);
    console.log(`    WIDE  (P75)   ${pad(t.strikes.wide.toFixed(2), 6)}%   ${listed(t, "wide")}`);

    for (const w of t.warnings ?? []) {
      console.log(`\n  WARNING  ${w}`);
    }

    console.log("");
  }
}

function listed(t: { rungs: readonly string[] }, rung: string): string {
  return t.rungs.includes(rung) ? "listed" : "not listed";
}

function pad(s: string, width: number): string {
  return s.padStart(width);
}

main().catch((err: unknown) => {
  console.error(`\nstrike calibration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
