// =============================================================================
// Frontend configuration
// =============================================================================
//
// Every address and constant the UI depends on, in one place. Values that the
// program also knows about are copied from its constants and the Rust side is
// the authority. Anything deployment specific can be overridden with a
// NEXT_PUBLIC_* variable, but the defaults are the live devnet deployment so
// the app runs with no configuration at all.

import { PublicKey } from "@solana/web3.js";

/** The MoveX Equities program on devnet. */
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "7L9xYzMLHNRtnQYB9w7Djx4UAAmW3CnJxLHhEHJnRW6Q",
);

/** USDX, the test quote asset every market is denominated in. */
export const QUOTE_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_QUOTE_MINT ?? "8opqdnKkNEgneiJWkfW8EExTfpKssRqXuR6BBY86uYCu",
);

export const CLUSTER = "devnet" as const;

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------
//
// Two ways to reach the cluster, and which one is used depends on where the
// endpoint is configured:
//
//   NEXT_PUBLIC_RPC_URL   the browser talks to it directly. Convenient
//                         locally, but the value ships in the bundle, so
//                         never point it at a URL carrying a key you care
//                         about.
//   RPC_URL               server only. The browser talks to /api/rpc and the
//                         route handler forwards, so the key stays private.
//                         This is what a deployment should use.
//
// With neither set, both paths end at the public devnet endpoint, which
// needs no key but rate limits getProgramAccounts hard.

const DIRECT_RPC = process.env.NEXT_PUBLIC_RPC_URL?.trim();

export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
export const PUBLIC_DEVNET_WS = "wss://api.devnet.solana.com/";

/** Where the browser sends JSON-RPC. */
export function rpcEndpoint(): string {
  if (DIRECT_RPC) return DIRECT_RPC;
  // Same origin, so the proxy works on any deployment without being told
  // its own URL. On the server nothing is fetched, so the value only has to
  // be a legal URL.
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return PUBLIC_DEVNET_RPC;
}

/**
 * Where account subscriptions connect.
 *
 * A websocket cannot go through a route handler, so when the proxy is in use
 * subscriptions talk to the cluster directly. That endpoint carries no key
 * and only ever receives account addresses, which are public anyway. Left
 * undefined for a direct endpoint, where web3.js derives the websocket URL
 * from the HTTP one.
 */
export function wsEndpoint(): string | undefined {
  return DIRECT_RPC ? undefined : PUBLIC_DEVNET_WS;
}

export const QUOTE_SYMBOL = "USDX";
export const QUOTE_DECIMALS = 6;

/** Matches KEEPER_PRICE_EXPONENT in the program: prices are u64 scaled 1e8. */
export const PRICE_DECIMALS = 8;

/** Matches MAX_PRICE_AGE_SECS in the program's oracle.rs. */
export const MAX_PRICE_AGE_SECS = 120;

/** Matches MIN_DEPOSIT in the program's constants.rs (1 USDX). */
export const MIN_DEPOSIT_BASE = 1_000_000n;

/** Matches VOID_GRACE_SECS in the program (six hours). */
export const VOID_GRACE_SECS = 6 * 60 * 60;

/**
 * Matches CRANK_GRACE_MINUTES in the keeper.
 *
 * Past this much time beyond its moment the crank stops trying to lock or
 * settle a market, because the price it would record is no longer the price
 * the market was sold on. A market that passes this point can only be
 * voided, so the board says so rather than showing it as about to lock
 * forever.
 */
export const CRANK_GRACE_SECS = 20 * 60;

// Which assets exist, and on which venue, lives in assets.ts.

/** Polling cadences in milliseconds. The publisher writes once a minute. */
export const POLL_MS = {
  markets: 15_000,
  feeds: 8_000,
  positions: 12_000,
  balances: 15_000,
  faucet: 30_000,
} as const;

export const SOL_FAUCET_URL = "https://faucet.solana.com/";

export const GITHUB_URL = "https://github.com/0xDub-1/MoveX_Equities";

export function explorerAddress(address: string | PublicKey): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=${CLUSTER}`;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}
