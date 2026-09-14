// Prints the seed wallets so they can be watched on the explorer.
//
//   npx tsx scripts/seed-wallets.ts
import { Keypair } from "@solana/web3.js";
import { getKeypair } from "../lib/lambdas/shared/solana";
import { SEED_WALLET_COUNT, seedBytes } from "../lib/lambdas/shared/seeding";

(async () => {
  const publisher = await getKeypair();
  for (let i = 0; i < SEED_WALLET_COUNT; i++) {
    const kp = Keypair.fromSeed(seedBytes(publisher.secretKey, i));
    console.log(`  ${i}  ${kp.publicKey.toBase58()}`);
  }
})();
