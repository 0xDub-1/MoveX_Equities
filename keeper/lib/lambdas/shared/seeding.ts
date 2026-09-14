// =============================================================================
// Seeding rules
// =============================================================================
//
// The pure part of the seeder: how wallets are derived, which side a wallet
// takes, and how much it puts in. Kept free of any Solana import so it can be
// unit tested. Randomness is injected so tests can pin it.

import { createHash } from "node:crypto";

export type Side = "above" | "below";
export type Rng = () => number;

/**
 * Three wallets, each drawing 10,000 USDX a day from the faucet and spreading
 * it across the day's markets. Roughly 30,000 USDX of seeded liquidity daily.
 */
export const SEED_WALLET_COUNT = 3;

/**
 * Each deposit is drawn from this range, in USDX base units.
 *
 * Fifteen markets a day (six hourly, nine daily) at an average of 650 comes
 * to about 9,750, which is the daily faucet allowance with winnings on top.
 */
export const DEPOSIT_MIN = 300_000_000n; // 300 USDX
export const DEPOSIT_MAX = 1_000_000_000n; // 1,000 USDX

/** The faucet's own cooldown, mirrored here to avoid a refused call every tick. */
export const FAUCET_COOLDOWN_SECS = 24 * 60 * 60;

/** SOL each wallet holds for rent on its own accounts, in lamports. */
export const SOL_TARGET = 200_000_000; // 0.2 SOL
export const SOL_REFILL_BELOW = 50_000_000; // 0.05 SOL

/**
 * Seed bytes for wallet `index`, derived from the publisher's secret.
 *
 * Deterministic, so the same wallets come back on every invocation without
 * a second secret in SSM. Deriving from the publisher adds no exposure: an
 * attacker holding that key already controls everything of value here, and
 * the derived wallets hold only devnet test tokens.
 */
export function seedBytes(publisherSecret: Uint8Array, index: number): Uint8Array {
  return createHash("sha256")
    .update(publisherSecret.subarray(0, 32))
    .update("movex-equities-seed-wallet")
    .update(Buffer.from([index]))
    .digest();
}

/**
 * Which side a wallet takes, given what the pools already hold.
 *
 * An empty side is filled first, so a market can never be left one-sided by
 * the draw and void at lock. Once both sides hold something the choice is
 * random, which is what spreads wins and losses across the wallets over time
 * rather than pinning any of them to one side.
 */
export function chooseSide(abovePool: bigint, belowPool: bigint, rng: Rng = Math.random): Side {
  if (abovePool === 0n) return "above";
  if (belowPool === 0n) return "below";
  return rng() < 0.5 ? "above" : "below";
}

/** A fresh random amount inside the configured range. */
export function randomAmount(rng: Rng = Math.random): bigint {
  const span = Number(DEPOSIT_MAX - DEPOSIT_MIN);
  return DEPOSIT_MIN + BigInt(Math.floor(rng() * (span + 1)));
}

/** Fisher-Yates, returning a new array. Order is what makes the draw fair. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
