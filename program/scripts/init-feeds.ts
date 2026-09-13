// Opens a keeper price feed per ticker.
//
// Doubles as the decisive check that the program upgrade landed: update_price
// and init_price_feed only exist in a keeper-oracle build, so if the deployed
// binary were the old one this fails with a missing instruction rather than
// silently doing nothing.
//
//   npx tsx init-feeds.ts

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const KEY = process.env.HELIUS_KEY ?? "";
const RPC = KEY
  ? `https://devnet.helius-rpc.com/?api-key=${KEY}`
  : "https://api.devnet.solana.com";
const KEYPAIR_PATH = `${process.env.HOME}/.config/solana/devnet.json`;
const OUT = new URL("./devnet.json", import.meta.url);

/** Right-padded to 8 bytes, matching the program's PDA seed. */
const TICKERS = ["NVDA", "TSLA", "SPY"];

function pad8(sym: string): Buffer {
  const b = Buffer.alloc(8, 0x20); // space padded
  Buffer.from(sym, "ascii").copy(b);
  return b;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))),
  );
  const provider = new AnchorProvider(connection, new Wallet(authority), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    readFileSync(new URL("../target/idl/movex_equities.json", import.meta.url), "utf8"),
  );
  const program = new Program(idl, provider);

  console.log(`rpc       ${KEY ? "helius devnet" : "public devnet"}`);
  console.log(`program   ${program.programId.toBase58()}`);
  console.log(`publisher ${authority.publicKey.toBase58()}\n`);

  if (!(program.methods as any).initPriceFeed) {
    throw new Error(
      "the local IDL has no initPriceFeed: build with --features keeper-oracle",
    );
  }

  const feeds: Record<string, string> = {};

  for (const symbol of TICKERS) {
    const underlying = pad8(symbol);
    const [feed] = PublicKey.findProgramAddressSync(
      [Buffer.from("price_feed"), underlying],
      program.programId,
    );

    const existing = await connection.getAccountInfo(feed);
    if (existing) {
      console.log(`${symbol.padEnd(6)} ${feed.toBase58()}  (already open)`);
    } else {
      await program.methods
        .initPriceFeed(Array.from(underlying), authority.publicKey)
        .accounts({
          authority: authority.publicKey,
          priceFeed: feed,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`${symbol.padEnd(6)} ${feed.toBase58()}  (opened)`);
    }
    feeds[symbol] = feed.toBase58();
  }

  const deployment = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  deployment.priceFeeds = feeds;
  deployment.publisher = authority.publicKey.toBase58();
  writeFileSync(OUT, JSON.stringify(deployment, null, 2));

  console.log(`\nwrote ${OUT.pathname}`);
  console.log("\nThe upgrade landed: these instructions do not exist in the old binary.");
}

main().catch((err) => {
  console.error("\nfailed:", err?.message ?? err);
  process.exit(1);
});
