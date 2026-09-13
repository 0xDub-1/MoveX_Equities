// Smoke test: can the TypeScript client read an IDL produced by anchor-cli
// 1.2? The npm package versions independently of the Rust crate, so this is
// the one thing worth confirming before building anything on top of it.
import { readFileSync } from "node:fs";
import { BN, BorshCoder, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const idl = JSON.parse(
  readFileSync(new URL("../target/idl/movex_equities.json", import.meta.url), "utf8"),
);

console.log("idl address :", idl.address);
console.log("idl version :", idl.metadata?.version, "spec:", idl.metadata?.spec);
console.log("instructions:", idl.instructions.map((i: any) => i.name).join(", "));
console.log("accounts    :", idl.accounts.map((a: any) => a.name).join(", "));

// The real test: can it build a coder and encode an instruction?
const coder = new BorshCoder(idl);
// Variants are PascalCase in an anchor-cli 1.2 IDL, matching the Rust names,
// not the camelCase older Anchor used.
const data = coder.instruction.encode("deposit", {
  side: { Above: {} },
  amount: new BN(1_000_000),
});
console.log("encoded deposit ix:", data.length, "bytes");

// And a struct arg with fixed-size arrays, which is what init_market needs.
const params = coder.instruction.encode("init_market", {
  params: {
    underlying: Array.from(Buffer.from("NVDA    ")),
    session_date: Array.from(Buffer.from("2026-09-16")),
    tier: { Fair: {} },
    strike_bps: 155,
    samples_bps: [
      3, 6, 7, 33, 84, 91, 98, 99, 148, 151, 159, 180, 201, 219, 234, 237, 291,
      321, 457, 874,
    ],
    fee_bps: 100,
    treasury: PublicKey.default,
    lock_ts: new BN(0),
    settle_ts: new BN(1),
  },
});
console.log("encoded init_market ix:", params.length, "bytes");

// And can it construct a Program, which is what the setup script needs?
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
  commitment: "confirmed",
});
const program = new Program(idl, provider);
console.log("program id  :", program.programId.toBase58());

// PDA derivation, which everything else depends on.
const [market] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("market"),
    Buffer.from("NVDA    "),
    Buffer.from("2026-09-16"),
    Buffer.from("fair"),
  ],
  program.programId,
);
console.log("sample market PDA:", market.toBase58());
console.log("\nOK");
