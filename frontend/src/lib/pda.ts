// =============================================================================
// Program derived addresses
// =============================================================================
//
// Mirrors the seeds in the program's constants.rs. The keeper derives the
// same addresses, so a market the keeper created is found here by
// construction rather than by scanning.

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { PROGRAM_ID, QUOTE_MINT } from "./config";

export type Tier = "tight" | "fair" | "wide";

/** Ticker as the program stores it: ASCII, right-padded with spaces to 8. */
export function underlyingBytes(symbol: string): Buffer {
  if (symbol.length > 8) throw new Error(`ticker ${symbol} exceeds 8 bytes`);
  const buf = Buffer.alloc(8, 0x20);
  buf.write(symbol, "ascii");
  return buf;
}

/** Session identifier as the program stores it: exactly 10 bytes. */
export function sessionBytes(sessionId: string): Buffer {
  if (sessionId.length > 10) throw new Error(`session id ${sessionId} exceeds 10 bytes`);
  const buf = Buffer.alloc(10, 0x20);
  buf.write(sessionId, "ascii");
  return buf;
}

/** Decodes a space-padded byte array back into its string. */
export function bytesToString(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("ascii").trim();
}

const TIER_SEED: Record<Tier, Buffer> = {
  tight: Buffer.from("tight"),
  fair: Buffer.from("fair"),
  wide: Buffer.from("wide"),
};

export function priceFeedPda(symbol: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), underlyingBytes(symbol)],
    PROGRAM_ID,
  )[0];
}

export function marketPda(symbol: string, sessionId: string, tier: Tier): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), underlyingBytes(symbol), sessionBytes(sessionId), TIER_SEED[tier]],
    PROGRAM_ID,
  )[0];
}

export function vaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], PROGRAM_ID)[0];
}

export function positionPda(market: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function faucetPda(mint: PublicKey = QUOTE_MINT): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("faucet"), mint.toBuffer()], PROGRAM_ID)[0];
}

export function faucetClaimPda(user: PublicKey, mint: PublicKey = QUOTE_MINT): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_claim"), mint.toBuffer(), user.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** The user's USDX associated token account. */
export function quoteAta(owner: PublicKey, mint: PublicKey = QUOTE_MINT): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}
