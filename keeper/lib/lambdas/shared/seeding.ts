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
 * Six wallets, each drawing 10,000 USDX a day from its own faucet allowance,
 * so about 60,000 USDX a day in all.
 *
 * More wallets only help because each market is backed by a subset of them.
 * Funding every market from every wallet would raise the bill exactly as
 * fast as the budget, and the shortfall that left markets one-sided would
 * survive the change untouched.
 */
export const SEED_WALLET_COUNT = 6;

/**
 * How many wallets back one market.
 *
 * Two is the floor, because both sides have to hold something or the market
 * voids at lock for want of a counterparty. Three makes a pool read as a
 * handful of participants rather than a duel. Past that the budget goes on
 * something nobody can see.
 *
 * With fifteen markets a day this asks for 45 deposits against six daily
 * allowances, which is roughly double the cover the old three wallets had.
 */
export const DEPOSITORS_PER_MARKET = 3;

/**
 * Each deposit is drawn from this range, in USDX base units, narrowed by
 * whatever share of the wallet's balance the markets still to fund allow.
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

/**
 * What one deposit should be, given what the wallet holds and how many
 * markets it still has to reach.
 *
 * The seeder used to draw from the full range regardless of balance and
 * spend first come, first served. On a day when the arithmetic ran close it
 * emptied the early wallets and the markets created late in the afternoon
 * got nothing, which left them one-sided and bound to void at lock. Sizing
 * each deposit to its share of what is left means the money reaches every
 * market or it reaches none of them short.
 *
 * Returns zero when the wallet cannot cover even the minimum, which the
 * caller reads as "skip".
 */
export function depositAmount(
  balance: bigint,
  marketsRemaining: number,
  rng: Rng = Math.random,
): bigint {
  if (balance < DEPOSIT_MIN) return 0n;

  const remaining = BigInt(Math.max(1, marketsRemaining));
  const share = balance / remaining;

  // Too thin to randomise: fund at the minimum and reach as many as possible.
  if (share <= DEPOSIT_MIN) return DEPOSIT_MIN;

  const cap = share < DEPOSIT_MAX ? share : DEPOSIT_MAX;
  const span = Number(cap - DEPOSIT_MIN);
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
