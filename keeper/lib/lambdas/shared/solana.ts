// =============================================================================
// Solana access for the keeper lambdas
// =============================================================================
//
// One place that knows how to get a signing keypair and a Program, so the
// four lambdas differ only in what they do with them.

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { Logger } from "@aws-lambda-powertools/logger";

import idlJson from "./idl/movex_equities.json";

const logger = new Logger({ serviceName: "movex-equities-keeper" });

const ssm = new SSMClient({});

/** Where the publisher's secret lives. Read-only, and never logged. */
const KEYPAIR_PARAMETER =
  process.env.KEYPAIR_PARAMETER ?? "/movex_equities/main_keypair";

/**
 * Cached across invocations.
 *
 * Lambda reuses a warm container, so without this every tick would hit SSM.
 * At one invocation a minute through a session that is ~400 needless calls a
 * day, and SSM's default throughput is a shared account-wide budget worth not
 * spending on a value that never changes.
 */
let cachedKeypair: Keypair | undefined;
let cachedProgram: Program | undefined;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decoded inline rather than pulling bs58 in for fifteen lines. */
function base58Decode(input: string): Uint8Array {
  const bytes = [0];
  for (const ch of input) {
    const value = BASE58.indexOf(ch);
    if (value < 0) throw new Error("secret is not valid base58");
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of input) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return Uint8Array.from(bytes.reverse());
}

/**
 * Local runs only. When set, the secret is read from this file instead of
 * the parameter store, so a script can exercise a lambda's code path with
 * the Solana CLI keypair and no AWS session. Never set in the stack.
 */
const KEYPAIR_PATH = process.env.KEYPAIR_PATH;

export async function getKeypair(): Promise<Keypair> {
  if (cachedKeypair) return cachedKeypair;

  let raw: string | undefined;
  if (KEYPAIR_PATH) {
    const { readFileSync } = await import("node:fs");
    raw = readFileSync(KEYPAIR_PATH, "utf8").trim();
  } else {
    const result = await ssm.send(
      new GetParameterCommand({ Name: KEYPAIR_PARAMETER, WithDecryption: true }),
    );
    raw = result.Parameter?.Value?.trim();
  }
  if (!raw) throw new Error(`${KEYPAIR_PATH ?? KEYPAIR_PARAMETER} is empty`);

  // Accepts either the base58 form wallets export or the JSON byte array the
  // Solana CLI writes, so the parameter can be populated from either without
  // anyone having to know which this expects.
  let secret: Uint8Array;
  if (raw.startsWith("[")) {
    secret = Uint8Array.from(JSON.parse(raw));
  } else {
    secret = base58Decode(raw);
  }

  cachedKeypair =
    secret.length === 64
      ? Keypair.fromSecretKey(secret)
      : Keypair.fromSeed(secret.slice(0, 32));

  // The public key is safe to log and worth logging: it is how you confirm
  // the lambda is signing as the account you think it is.
  logger.info("loaded keypair", { publicKey: cachedKeypair.publicKey.toBase58() });
  return cachedKeypair;
}

export async function getProgram(): Promise<Program> {
  if (cachedProgram) return cachedProgram;

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is not set");

  const keypair = await getKeypair();
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
  });

  // The IDL is bundled rather than fetched from chain. `solana program
  // deploy` upgrades the binary without touching the on-chain IDL, so that
  // copy can silently lag the program it claims to describe.
  cachedProgram = new Program(idlJson as Idl, provider);
  return cachedProgram;
}

/**
 * `getMultipleAccountsInfo` in slices of a hundred keys, the RPC's limit per
 * call. The candidate lists grow with every listed asset, and a list that
 * crossed the limit would fail every tick rather than one.
 */
export async function getAccountInfos(
  connection: Connection,
  keys: readonly PublicKey[],
): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 100))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

/** Ticker as the program stores it: ASCII, right-padded with spaces to 8. */
export function underlyingBytes(symbol: string): Buffer {
  if (symbol.length > 8) throw new Error(`ticker ${symbol} exceeds 8 bytes`);
  const buf = Buffer.alloc(8, 0x20);
  buf.write(symbol, "ascii");
  return buf;
}

/** Session identifier as the program stores it: exactly 10 bytes. */
export function sessionBytes(sessionId: string): Buffer {
  if (sessionId.length > 10) {
    throw new Error(`session id ${sessionId} exceeds 10 bytes`);
  }
  const buf = Buffer.alloc(10, 0x20);
  buf.write(sessionId, "ascii");
  return buf;
}

const TIER_SEED: Record<string, Buffer> = {
  tight: Buffer.from("tight"),
  fair: Buffer.from("fair"),
  wide: Buffer.from("wide"),
};

export function priceFeedPda(programId: PublicKey, symbol: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), underlyingBytes(symbol)],
    programId,
  )[0];
}

export function marketPda(
  programId: PublicKey,
  symbol: string,
  sessionId: string,
  tier: "tight" | "fair" | "wide",
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      underlyingBytes(symbol),
      sessionBytes(sessionId),
      TIER_SEED[tier],
    ],
    programId,
  )[0];
}

export function vaultPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    programId,
  )[0];
}

/**
 * Anchor's borsh coder wants BN for u64 and i64 arguments, not a native
 * bigint or number. Passing the wrong one fails deep inside the layout
 * encoder with `src.toArrayLike is not a function`, which names neither the
 * argument nor the instruction, so every call site goes through here.
 */
export function bn(value: bigint | number): BN {
  return new BN(value.toString());
}

/**
 * Enum arguments, spelled the one way Anchor's coder accepts.
 *
 * Anchor camelCases every name in the IDL when the Program is constructed,
 * variant names included, and the borsh enum layout then looks the argument
 * up by that camelCased key. `{ Tight: {} }` fails inside the encoder with
 * "unable to infer src variant"; `{ tight: {} }` is the only form that
 * encodes. Decoded accounts come back the same way: `{ open: {} }`.
 */
export const TIER_VARIANT = {
  tight: { tight: {} },
  fair: { fair: {} },
  wide: { wide: {} },
} as const;

export type SideKey = "above" | "below";

export const SIDES: readonly SideKey[] = ["above", "below"];

const SIDE_SEED: Record<SideKey, Buffer> = {
  above: Buffer.from("above"),
  below: Buffer.from("below"),
};

/** One position per user, market and side: the side is in the address. */
export function positionPda(
  programId: PublicKey,
  market: PublicKey,
  user: PublicKey,
  side: SideKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer(), SIDE_SEED[side]],
    programId,
  )[0];
}

export function faucetPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("faucet"), mint.toBuffer()], programId)[0];
}

export function faucetClaimPda(programId: PublicKey, mint: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_claim"), mint.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

export const SIDE_VARIANT = {
  above: { above: {} },
  below: { below: {} },
} as const;
