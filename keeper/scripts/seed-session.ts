// =============================================================================
// Seed markets now, outside the schedule
// =============================================================================
//
// Runs the Seeder lambda's own code path locally, signing with the Solana CLI
// keypair instead of the SSM parameter. The seed wallets are derived from the
// signing key, so this reaches the same six wallets the lambda uses.
//
// The lambda only seeds on a trading day. This does not: the candidates for a
// Saturday already include Monday's hours and the ladder that locks at
// Monday's close, which is exactly what needs funding after a redeploy over a
// weekend. Idempotent, like the lambda: a wallet already in a market is
// skipped, so running it twice deposits nothing twice.
//
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=... npx tsx scripts/seed-session.ts
//   RPC_URL=... npx tsx scripts/seed-session.ts 2026-09-19

// The keeper reads its configuration from the environment at module load, so
// the defaults have to be in place before anything under lib/ is imported.
if (!process.env.KEYPAIR_PATH) {
  process.env.KEYPAIR_PATH = `${process.env.HOME}/.config/solana/devnet.json`;
}
if (!process.env.QUOTE_MINT) {
  process.env.QUOTE_MINT = "8opqdnKkNEgneiJWkfW8EExTfpKssRqXuR6BBY86uYCu";
}
if (!process.env.RPC_URL) {
  process.env.RPC_URL = "https://api.devnet.solana.com";
}

async function main() {
  // .js on purpose: nodenext resolution wants the emitted extension on a
  // dynamic import, and tsx maps it back to the .ts source at run time.
  const { seedMarkets } = await import("../lib/lambdas/keeper/seeder.js");
  const { easternDate } = await import("../lib/lambdas/shared/calendar.js");

  const requested = process.argv[2];
  if (requested !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    throw new Error(`date wants YYYY-MM-DD, got ${requested}`);
  }
  const today = requested ?? easternDate();

  console.log(`rpc        ${process.env.RPC_URL!.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`candidates as of ${today}\n`);

  const result = await seedMarkets(today);

  console.log(`\ndeposited ${result.deposited.length}`);
  for (const d of result.deposited) console.log(`  ${d}`);
  console.log(`claimed   ${result.claimed.length}`);
  for (const c of result.claimed) console.log(`  ${c}`);
}

main().catch((err) => {
  console.error("\nseed-session failed:", err?.message ?? err);
  process.exit(1);
});
