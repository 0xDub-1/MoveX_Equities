// =============================================================================
// Anchor program handle
// =============================================================================
//
// The IDL is bundled rather than fetched from chain. `solana program deploy`
// upgrades the binary without touching the on-chain IDL, so that copy can
// silently lag the program it claims to describe.

import { AnchorProvider, Program, type Provider } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";

import idlJson from "./idl/movex_equities.json";
import type { MovexEquities } from "./idl/movex_equities";

export type MovexProgram = Program<MovexEquities>;

/**
 * A program handle bound to `wallet` when one is connected, or read-only
 * otherwise. Reads never need a signer, so the market list renders for a
 * visitor with no wallet at all.
 */
export function createProgram(connection: Connection, wallet?: AnchorWallet): MovexProgram {
  const provider: Provider = wallet
    ? new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      })
    : { connection };
  return new Program<MovexEquities>(idlJson as unknown as MovexEquities, provider);
}

/**
 * Anchor spells enum variants in camelCase on the TypeScript side, both when
 * encoding an argument and when decoding an account. `{ above: {} }` is the
 * only form the coder accepts.
 */
export const SIDE_ARG = {
  above: { above: {} },
  below: { below: {} },
} as const;
