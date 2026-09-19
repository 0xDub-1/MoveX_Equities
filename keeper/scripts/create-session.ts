// =============================================================================
// Create today's markets ahead of the schedule
// =============================================================================
//
// Runs the market lambdas' own code path locally, signing with the Solana
// CLI keypair instead of the SSM parameter, so init_market is exercised
// against devnet before the 09:00 run rather than during it. The lambdas are
// idempotent and will find these markets already there.
//
// Creates, for one session (today by default, or --session YYYY-MM-DD):
//   - that day's hourly markets, exactly what HourlyMarkets creates
//   - the daily ladder that locks at that day's close and settles at the next
//     session's close, the one DailyMarkets would have created the previous
//     session at 15:55
//
// The lambdas only ever create on a trading day, by design. --session is how
// the next session's markets get created on a weekend, after a redeploy for
// instance, when the schedule would otherwise leave the board empty until the
// morning backstop. init_market refuses a lock in the past, so a session that
// has already begun only yields the markets still ahead of it.
//
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=... npx tsx scripts/create-session.ts --dry-run
//   RPC_URL=... npx tsx scripts/create-session.ts
//   RPC_URL=... npx tsx scripts/create-session.ts --session 2026-09-21

import { readFileSync } from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  easternDate,
  isTradingDay,
  nextTradingDay,
} from "../lib/lambdas/shared/calendar";
import { HOURLY_TICKER, PUBLISHED_TICKERS } from "../lib/lambdas/shared/config";
import { dailyLadder, hourlyLadder } from "../lib/lambdas/shared/ladders";
import {
  dailySpec,
  ensureMarkets,
  hourlySpecs,
  type MarketSpec,
  type Tier,
} from "../lib/lambdas/shared/markets";
import { marketPda } from "../lib/lambdas/shared/solana";
import { TICKERS } from "../lib/lambdas/strikes/config";
import idlJson from "../lib/lambdas/shared/idl/movex_equities.json";

const QUOTE_MINT = new PublicKey("8opqdnKkNEgneiJWkfW8EExTfpKssRqXuR6BBY86uYCu");
const KEYPAIR_PATH = `${process.env.HOME}/.config/solana/devnet.json`;
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

const DAILY_RUNGS: Record<string, Tier[]> = Object.fromEntries(
  TICKERS.map((t) => [t.symbol, [...t.rungs] as Tier[]]),
);

function fmtEt(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const flag = process.argv.indexOf("--session");
  const requested = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    throw new Error(`--session wants YYYY-MM-DD, got ${requested}`);
  }

  const session = requested ?? easternDate();
  if (!isTradingDay(session)) {
    console.log(`${session} is not a session. Nothing to create.`);
    return;
  }
  const next = nextTradingDay(session);

  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))),
  );
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
  });
  const program = new Program(idlJson as Idl, provider);

  console.log(`rpc        ${RPC_URL.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`authority  ${keypair.publicKey.toBase58()}`);
  console.log(`session    ${session}, next session ${next}\n`);

  // -- hourly, for the session ------------------------------------------------
  const hourly = await hourlyLadder(HOURLY_TICKER);
  const specs: MarketSpec[] = hourlySpecs(session, HOURLY_TICKER, hourly.strikeBps, hourly.samplesBps);
  console.log(`hourly ${HOURLY_TICKER}: FAIR ${(hourly.strikeBps / 100).toFixed(2)}%`);
  console.log(`  samples ${hourly.samplesBps.join(" ")}`);

  // -- daily, locking at the session's close ----------------------------------
  for (const symbol of PUBLISHED_TICKERS) {
    const ladder = await dailyLadder(symbol);
    console.log(
      `daily ${symbol}: TIGHT ${(ladder.strikes.tight / 100).toFixed(2)}%  ` +
        `FAIR ${(ladder.strikes.fair / 100).toFixed(2)}%  WIDE ${(ladder.strikes.wide / 100).toFixed(2)}%`,
    );
    console.log(`  samples ${ladder.samplesBps.join(" ")}`);
    for (const tier of DAILY_RUNGS[symbol] ?? ["fair"]) {
      specs.push(dailySpec(session, next, symbol, tier, ladder.strikes[tier], ladder.samplesBps));
    }
  }

  console.log(`\n${specs.length} markets:`);
  for (const s of specs) {
    const address = marketPda(program.programId, s.symbol, s.sessionId, s.tier);
    const exists = await connection.getAccountInfo(address);
    console.log(
      `  ${s.kind.padEnd(6)} ${s.symbol.padEnd(4)} ${s.sessionId.padEnd(10)} ${s.tier.padEnd(5)} ` +
        `${(s.strikeBps / 100).toFixed(2).padStart(5)}%  lock ${fmtEt(s.lockTs)}  settle ${fmtEt(s.settleTs)}  ` +
        `${exists ? "exists" : "new"}  ${address.toBase58()}`,
    );
  }

  if (dryRun) {
    console.log("\nDry run. Nothing sent.");
    return;
  }

  console.log("\ncreating...");
  const result = await ensureMarkets(program, QUOTE_MINT, keypair.publicKey, specs);
  console.log(`\ncreated  ${result.created.length}  ${result.created.join(", ")}`);
  console.log(`existing ${result.existing.length}  ${result.existing.join(", ")}`);
  console.log(`failed   ${result.failed.length}  ${result.failed.join(", ")}`);
  process.exitCode = result.failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("\ncreate-session failed:", err?.message ?? err);
  process.exit(1);
});
