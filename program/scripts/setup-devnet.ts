// =============================================================================
// Devnet setup
// =============================================================================
//
// Creates the USDX test mint, opens the faucet, and seeds a set of test
// wallets. Idempotent: re-running reuses whatever already exists, so it is
// safe to run after a redeploy without producing a second mint nobody is
// using.
//
// Market seeding lives in seed-markets.ts, because it needs strikes from the
// keeper and a Pyth feed address per ticker.
//
//   npx tsx setup-devnet.ts
//   npx tsx setup-devnet.ts --wallets 8
//
// Test wallets are funded through `faucet_mint`, the same instruction a real
// user calls from the browser. Seeding them through a side door would leave
// the path that actually ships untested.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/devnet.json`;
const OUT_PATH = new URL("./devnet.json", import.meta.url);

const USDX_DECIMALS = 6;
const USDX = 10 ** USDX_DECIMALS;

/** Matches the roadmap: 10,000 per claim, once a day. */
const FAUCET_AMOUNT = new BN(10_000 * USDX);
const FAUCET_COOLDOWN = new BN(24 * 60 * 60);

/** Enough SOL for a test wallet to pay rent on its accounts and sign freely. */
const WALLET_SOL = 0.5;

interface Deployment {
  cluster: string;
  programId: string;
  authority: string;
  usdxMint: string;
  faucet: string;
  faucetAmountPerClaim: string;
  faucetCooldownSecs: string;
  wallets: { pubkey: string; secretKey: number[]; usdxAccount: string }[];
  markets?: unknown[];
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public devnet RPC drops requests and expires blockhashes under any real
 * load. Every one of those is transient and the operation is safe to repeat,
 * so a failure here should cost a few seconds rather than a half-finished
 * deployment.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const transient =
        /Blockhash not found|block height exceeded|429|Too Many Requests|timed out|fetch failed|socket hang up/i.test(
          message,
        );
      if (!transient || i === attempts) break;
      const backoff = 1_000 * 2 ** (i - 1);
      console.log(`  ${label}: ${message.split("\n")[0]} — retry ${i}/${attempts - 1} in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function faucetPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet"), mint.toBuffer()],
    programId,
  )[0];
}

function faucetClaimPda(
  programId: PublicKey,
  mint: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_claim"), mint.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

async function main() {
  const walletCount = arg("wallets", 5);

  const connection = new Connection(RPC, "confirmed");
  const authority = loadKeypair(KEYPAIR_PATH);
  const provider = new AnchorProvider(connection, new Wallet(authority), {
    commitment: "confirmed",
  });

  const idl = JSON.parse(
    readFileSync(new URL("../target/idl/movex_equities.json", import.meta.url), "utf8"),
  );
  const program = new Program(idl, provider);

  console.log(`cluster   ${RPC}`);
  console.log(`program   ${program.programId.toBase58()}`);
  console.log(`authority ${authority.publicKey.toBase58()}`);
  console.log(
    `balance   ${(await connection.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL} SOL\n`,
  );

  const existing: Partial<Deployment> = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, "utf8"))
    : {};

  // -- USDX mint ------------------------------------------------------------
  //
  // The faucet PDA is derived from the mint and must also be its authority.
  // Not circular: the mint's address is known once its keypair exists, so the
  // PDA can be derived before the account is initialised.
  let usdxMint: PublicKey;
  if (existing.usdxMint && (await connection.getAccountInfo(new PublicKey(existing.usdxMint)))) {
    usdxMint = new PublicKey(existing.usdxMint);
    console.log(`USDX mint  ${usdxMint.toBase58()}  (reused)`);
  } else {
    const mintKp = Keypair.generate();
    const faucet = faucetPda(program.programId, mintKp.publicKey);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKp.publicKey,
        USDX_DECIMALS,
        faucet, // mint authority is the PDA, so faucet_mint is the only supply path
        null,
      ),
    );
    await sendAndConfirmTransaction(connection, tx, [authority, mintKp], {
      commitment: "confirmed",
    });
    usdxMint = mintKp.publicKey;
    console.log(`USDX mint  ${usdxMint.toBase58()}  (created)`);
    // Recorded immediately. A failure further down would otherwise orphan
    // this mint and the next run would create a second one.
    existing.usdxMint = usdxMint.toBase58();
    writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  }

  const faucet = faucetPda(program.programId, usdxMint);

  // -- Faucet ---------------------------------------------------------------
  if (await connection.getAccountInfo(faucet)) {
    console.log(`faucet     ${faucet.toBase58()}  (already open)`);
  } else {
    // The client camelCases what the IDL spells in snake_case, for both
    // method names and account keys.
    await program.methods
      .initFaucet(FAUCET_AMOUNT, FAUCET_COOLDOWN)
      .accounts({
        authority: authority.publicKey,
        faucet,
        mint: usdxMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`faucet     ${faucet.toBase58()}  (opened)`);
  }
  console.log(
    `           ${FAUCET_AMOUNT.toNumber() / USDX} USDX per claim, ${FAUCET_COOLDOWN.toNumber()}s cooldown\n`,
  );

  // -- Test wallets ---------------------------------------------------------
  const wallets: Deployment["wallets"] = existing.wallets ?? [];

  /** Written after every wallet, so an RPC failure never loses funded ones. */
  const save = () => {
    existing.wallets = wallets;
    writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  };

  while (wallets.length < walletCount) {
    const user = Keypair.generate();
    const idx = wallets.length + 1;

    await withRetry(`wallet ${idx} fund`, () =>
      sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: user.publicKey,
            lamports: WALLET_SOL * LAMPORTS_PER_SOL,
          }),
        ),
        [authority],
        { commitment: "confirmed" },
      ),
    );

    // A plain token account rather than an ATA, so the setup does not depend
    // on the associated-token program being what the frontend chooses later.
    const tokenAccount = Keypair.generate();
    const accountRent = await getMinimumBalanceForRentExemptAccount(connection);
    await withRetry(`wallet ${idx} token account`, () =>
      sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.createAccount({
            fromPubkey: user.publicKey,
            newAccountPubkey: tokenAccount.publicKey,
            space: ACCOUNT_SIZE,
            lamports: accountRent,
            programId: TOKEN_PROGRAM_ID,
          }),
          createInitializeAccount3Instruction(
            tokenAccount.publicKey,
            usdxMint,
            user.publicKey,
          ),
        ),
        [user, tokenAccount],
        { commitment: "confirmed" },
      ),
    );

    // Through the faucet, exactly as a browser user would.
    await withRetry(`wallet ${idx} faucet`, () =>
      program.methods
        .faucetMint()
      .accounts({
        user: user.publicKey,
        faucet,
        claim: faucetClaimPda(program.programId, usdxMint, user.publicKey),
        mint: usdxMint,
        userTokenAccount: tokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc(),
    );

    const balance = (await getAccount(connection, tokenAccount.publicKey)).amount;
    console.log(
      `wallet ${idx}   ${user.publicKey.toBase58()}  ${Number(balance) / USDX} USDX`,
    );

    wallets.push({
      pubkey: user.publicKey.toBase58(),
      secretKey: Array.from(user.secretKey),
      usdxAccount: tokenAccount.publicKey.toBase58(),
    });
    save();
  }

  const deployment: Deployment = {
    cluster: RPC,
    programId: program.programId.toBase58(),
    authority: authority.publicKey.toBase58(),
    usdxMint: usdxMint.toBase58(),
    faucet: faucet.toBase58(),
    faucetAmountPerClaim: FAUCET_AMOUNT.toString(),
    faucetCooldownSecs: FAUCET_COOLDOWN.toString(),
    wallets,
    ...(existing.markets ? { markets: existing.markets } : {}),
  };

  writeFileSync(OUT_PATH, JSON.stringify(deployment, null, 2));
  console.log(`\nwrote ${OUT_PATH.pathname}`);
  console.log(
    "\nThis file holds test-wallet secret keys. It is gitignored, and every\n" +
      "key in it controls nothing but valueless devnet tokens.",
  );
}

main().catch((err) => {
  console.error("\nsetup failed:", err);
  process.exit(1);
});
