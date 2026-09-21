// =============================================================================
// What the crypto lambdas would do right now
// =============================================================================
//
// Prints the ladders Hyperliquid implies for every listed asset, the hourly
// and daily slots the markets lambda would want to exist, and the candidates
// the crank and the seeder would walk. With RPC_URL set it also asks the
// chain which of those markets already exist, so a run reads like a dry run
// of the next tick.
//
//   npx tsx scripts/crypto-preview.ts
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=... npx tsx scripts/crypto-preview.ts

import { Connection, PublicKey } from "@solana/web3.js";

import { CRYPTO_ASSETS, coinOf } from "../lib/lambdas/shared/crypto-config";
import { allMids, cryptoLadder, midToQuote } from "../lib/lambdas/shared/hyperliquid";
import { marketPda, priceFeedPda } from "../lib/lambdas/shared/solana";
import { cryptoCandidates, dailySlotsAhead, hourlySlotsAhead } from "../lib/lambdas/shared/utc-sessions";
import idl from "../lib/lambdas/shared/idl/movex_equities.json";

const PROGRAM = new PublicKey((idl as { address: string }).address);
const rpc = process.env.RPC_URL;

const utc = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

async function main() {
  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`now        ${utc(nowSec)}`);
  console.log(`program    ${PROGRAM.toBase58()}`);
  console.log(`rpc        ${rpc ? rpc.replace(/api-key=.*/, "api-key=***") : "none, chain not consulted"}\n`);

  const mids = await allMids();
  console.log("=== mids ===");
  for (const asset of CRYPTO_ASSETS) {
    const quote = midToQuote(mids[coinOf(asset.symbol)], nowSec, coinOf(asset.symbol));
    console.log(`  ${asset.symbol.padEnd(5)} ${mids[coinOf(asset.symbol)]}  scaled ${quote.price}  feed ${priceFeedPda(PROGRAM, asset.symbol).toBase58()}`);
  }

  console.log("\n=== ladders ===");
  for (const asset of CRYPTO_ASSETS) {
    for (const interval of ["1h", "1d"] as const) {
      if (interval === "1h" && !asset.hourly) continue;
      if (interval === "1d" && asset.dailyRungs.length === 0) continue;
      const ladder = await cryptoLadder(coinOf(asset.symbol), interval);
      console.log(
        `  ${asset.symbol.padEnd(5)} ${interval}  tight ${pct(ladder.strikes.tight)}  fair ${pct(ladder.strikes.fair)}  wide ${pct(ladder.strikes.wide)}`,
      );
      console.log(`         samples ${ladder.samplesBps.join(" ")}`);
    }
  }

  const connection = rpc ? new Connection(rpc, "confirmed") : null;
  const exists = async (keys: PublicKey[]): Promise<boolean[]> => {
    if (!connection) return keys.map(() => false);
    const infos = await connection.getMultipleAccountsInfo(keys);
    return infos.map((i) => i !== null);
  };

  console.log("\n=== slots the markets lambda wants right now ===");
  for (const asset of CRYPTO_ASSETS) {
    if (asset.hourly) {
      const slots = hourlySlotsAhead(nowSec);
      const found = await exists(slots.map((s) => marketPda(PROGRAM, asset.symbol, s.sessionId, "fair")));
      slots.forEach((s, i) =>
        console.log(`  ${asset.symbol} hourly ${s.sessionId}  lock ${utc(s.lockTs)}  ${found[i] ? "exists" : "missing"}`),
      );
    }
    for (const slot of dailySlotsAhead(nowSec)) {
      const keys = asset.dailyRungs.map((t) => marketPda(PROGRAM, asset.symbol, slot.sessionId, t));
      const found = await exists(keys);
      console.log(
        `  ${asset.symbol} daily  ${slot.sessionId}  lock ${utc(slot.lockTs)}  ${asset.dailyRungs.map((t, i) => `${t}:${found[i] ? "exists" : "missing"}`).join(" ")}`,
      );
    }
  }

  const candidates = cryptoCandidates(nowSec);
  console.log(`\n=== candidates ===  ${candidates.length} in all`);
  const keys = candidates.map((c) => marketPda(PROGRAM, c.symbol, c.sessionId, c.tier));
  const found = await exists(keys);
  const onChain = candidates.filter((_, i) => found[i]);
  console.log(`  on chain: ${onChain.length}`);
  for (const c of onChain) console.log(`    ${c.symbol}/${c.sessionId}/${c.tier}`);
}

main().catch((err) => {
  console.error("\ncrypto-preview failed:", err?.message ?? err);
  process.exit(1);
});
