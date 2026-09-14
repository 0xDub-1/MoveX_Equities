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
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL",
);

/** USDX, the test quote asset every market is denominated in. */
export const QUOTE_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_QUOTE_MINT ?? "FBnaipfxQK8M3ZMMM3bwnzgbgKDLPGJ2rJdUANHocBve",
);

/**
 * RPC endpoint. The public devnet endpoint works but rate limits
 * getProgramAccounts aggressively; a Helius devnet URL in .env.local is the
 * recommended setup.
 */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export const CLUSTER = "devnet" as const;

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

/** Tickers the keeper publishes prices for, in display order. */
export const TICKERS = ["NVDA", "TSLA", "SPY"] as const;
export type Ticker = (typeof TICKERS)[number];

export const TICKER_NAMES: Record<Ticker, string> = {
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  SPY: "S&P 500 ETF",
};

/** The one ticker that carries intraday hourly markets. */
export const HOURLY_TICKER: Ticker = "NVDA";

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
