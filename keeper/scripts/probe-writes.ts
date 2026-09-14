// Exercises the two paths preflight could not: the hourly ladder against the
// live quote source, and an actual update_price write to devnet.
//
// update_price is safe to run outside market hours. It only requires the
// price to move strictly forward in time, not to be fresh; freshness is
// checked at lock and settle, which is where it matters.
//
//   npx tsx scripts/probe-writes.ts

import { hourlyLadder } from "../lib/lambdas/shared/ladders";
import { liveQuote } from "../lib/lambdas/shared/quotes";
import { bn, getProgram, priceFeedPda } from "../lib/lambdas/shared/solana";
import { hourlySlots } from "../lib/lambdas/shared/calendar";
import { HOURLY_TICKER } from "../lib/lambdas/shared/config";

async function main() {
  console.log("=== hourly ladder against live Yahoo data ===");
  const ladder = await hourlyLadder(HOURLY_TICKER);
  console.log(`  samples (bps): ${ladder.samplesBps.join(" ")}`);
  console.log(
    `  TIGHT ${(ladder.strikes.tight / 100).toFixed(2)}%   ` +
      `FAIR ${(ladder.strikes.fair / 100).toFixed(2)}%   ` +
      `WIDE ${(ladder.strikes.wide / 100).toFixed(2)}%`,
  );

  // The reason the hourly ladder exists. If it came out near the daily 1.55%
  // the markets would be one-sided and void for want of a counterparty.
  console.log(
    `  daily FAIR is 1.55%, so hourly is ${(ladder.strikes.fair / 155).toFixed(2)}x of it`,
  );

  console.log("\n=== update_price, a real write to devnet ===");
  const program = await getProgram();
  const feed = priceFeedPda(program.programId, HOURLY_TICKER);
  const quote = await liveQuote(HOURLY_TICKER);

  const accounts = program.account as unknown as {
    priceFeed: { fetch(a: typeof feed): Promise<any> };
  };
  const before = await accounts.priceFeed.fetch(feed);
  console.log(`  before: price ${before.price.toString()} publishTime ${before.publishTime}`);

  const sig = await program.methods
    .updatePrice(bn(quote.price), bn(quote.conf), bn(quote.publishTime), quote.sourceCount)
    .accounts({ publisher: program.provider.publicKey!, priceFeed: feed })
    .rpc();
  console.log(`  signature: ${sig}`);

  const after = await accounts.priceFeed.fetch(feed);
  console.log(`  after:  price ${after.price.toString()} publishTime ${after.publishTime}`);
  console.log(
    `  scaled back: ${Number(after.price) / 1e8}  sources ${after.sourceCount}`,
  );

  console.log("\n=== the monotonic guard, by replaying the same price ===");
  try {
    await program.methods
      .updatePrice(bn(quote.price), bn(quote.conf), bn(quote.publishTime), quote.sourceCount)
      .accounts({ publisher: program.provider.publicKey!, priceFeed: feed })
      .rpc();
    console.log("  FAIL: a replay was accepted");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      msg.includes("OraclePriceNotNewer") || msg.includes("6019") || msg.includes("not newer")
        ? "  ok: replay refused, the feed cannot roll backwards"
        : `  refused, but check the reason: ${msg.split("\n")[0]}`,
    );
  }

  console.log("\n=== market addresses the lambda will create tomorrow ===");
  for (const slot of hourlySlots("2026-09-14")) {
    console.log(`  ${slot.sessionId}  lock ${slot.lockMinutes / 60}:00`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nfailed:", err?.message ?? err);
  process.exit(1);
});
