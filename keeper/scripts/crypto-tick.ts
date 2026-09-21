// =============================================================================
// One crypto tick by hand
// =============================================================================
//
// Runs the crypto lambdas' own code paths locally, signing with the Solana
// CLI keypair instead of the SSM parameter: the publisher, then the markets
// lambda (create, seed, claim), then the crank. Idempotent like the lambdas,
// so running it twice creates and deposits nothing twice.
//
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=... npx tsx scripts/crypto-tick.ts
//   RPC_URL=... npx tsx scripts/crypto-tick.ts publisher    # one step only
//   RPC_URL=... npx tsx scripts/crypto-tick.ts markets
//   RPC_URL=... npx tsx scripts/crypto-tick.ts crank

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

type Step = "publisher" | "markets" | "crank";

async function main() {
  const only = process.argv[2] as Step | undefined;
  if (only && !["publisher", "markets", "crank"].includes(only)) {
    throw new Error(`unknown step ${only}; one of publisher, markets, crank`);
  }
  const steps: Step[] = only ? [only] : ["publisher", "markets", "crank"];

  console.log(`rpc  ${process.env.RPC_URL!.replace(/api-key=.*/, "api-key=***")}\n`);

  for (const step of steps) {
    console.log(`=== ${step} ===`);
    // .js on purpose: nodenext resolution wants the emitted extension on a
    // dynamic import, and tsx maps it back to the .ts source at run time.
    const mod = await import(`../lib/lambdas/crypto/${step}.js`);
    const result = await mod.handler();
    console.log(JSON.stringify(result, null, 2));
    console.log();
  }
}

main().catch((err) => {
  console.error("\ncrypto-tick failed:", err?.message ?? err);
  process.exit(1);
});
