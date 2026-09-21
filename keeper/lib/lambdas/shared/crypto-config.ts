// =============================================================================
// Crypto venue configuration
// =============================================================================
//
// The one list to extend when a crypto asset is listed. Everything else in
// the crypto lambdas derives from it: which feeds the publisher writes, which
// hourly and daily markets exist, which candidates the crank and the seeder
// walk. Listing an asset is one line here, one `init_price_feed` on chain
// (program/scripts/init-feeds.ts) and one line in the frontend's registry.
//
// Deliberately separate from the equities configuration. The two venues share
// a program and a wallet but nothing about their clocks: equities follow the
// NYSE calendar in New York time, crypto runs around the clock in UTC, and a
// change to one must never be able to reach the other.

import type { Tier } from "./markets";

export interface CryptoAsset {
  /**
   * The on-chain underlying, up to 8 ASCII bytes. The program stores it
   * right-padded with spaces and derives the feed and market addresses from
   * it, so it must never change once markets exist.
   */
  readonly symbol: string;
  /**
   * The Hyperliquid coin, when it differs from the symbol. HIP-3 assets carry
   * a dex prefix such as `xyz:XYZ100`, which does not fit the eight bytes the
   * program allows for an underlying.
   */
  readonly coin?: string;
  readonly name: string;
  /** Whether the asset carries hourly markets: one every hour, around the clock. */
  readonly hourly: boolean;
  /** Which rungs of the daily ladder get a market. Empty means no daily markets. */
  readonly dailyRungs: readonly Tier[];
}

/**
 * Hourly markets on BTC only, for the same reason only NVDA carries them on
 * the equities side: one deep intraday pool reads as a venue, three thin ones
 * read as a graveyard. Every asset gets the daily ladder.
 */
export const CRYPTO_ASSETS: readonly CryptoAsset[] = [
  { symbol: "BTC", name: "Bitcoin", hourly: true, dailyRungs: ["tight", "fair", "wide"] },
  { symbol: "ETH", name: "Ether", hourly: false, dailyRungs: ["tight", "fair", "wide"] },
  { symbol: "SOL", name: "Solana", hourly: false, dailyRungs: ["tight", "fair", "wide"] },
];

/** The rung an hourly market carries. The coin flip, as on equities. */
export const CRYPTO_HOURLY_TIER: Tier = "fair";

/**
 * How many hours before its lock an hourly market is created, which is also
 * how long its deposit window is. Each tick of the markets lambda makes sure
 * every hour inside this horizon exists, so a normal tick creates one market
 * and a tick after an outage creates up to four.
 */
export const CRYPTO_HOURLY_LEAD_HOURS = 4;

/**
 * How many hours before its lock a daily ladder is created. The lock is
 * midnight UTC, so the ladder for a day goes up just after the previous
 * midnight and takes deposits for a day, as the equities ladders do.
 */
export const CRYPTO_DAILY_LEAD_HOURS = 24;

/**
 * How far back the crank and the seeder look for hourly markets still needing
 * a settle, a void or a claim. The program voids a market that could not
 * resolve six hours past its settle time, so eight hours sees everything out.
 */
export const CRYPTO_HOURLY_LOOKBACK_HOURS = 8;

/** Same, in days, for the daily ladders. */
export const CRYPTO_DAILY_LOOKBACK_DAYS = 4;

/**
 * Days ahead the candidates reach. The ladder for tomorrow is the furthest
 * anything creates; one more day is slack for a clock that runs early.
 */
export const CRYPTO_DAILY_LOOKAHEAD_DAYS = 2;

export const CRYPTO_SYMBOLS: readonly string[] = CRYPTO_ASSETS.map((a) => a.symbol);

export const CRYPTO_HOURLY_SYMBOLS: readonly string[] = CRYPTO_ASSETS.filter((a) => a.hourly).map(
  (a) => a.symbol,
);

export function cryptoAsset(symbol: string): CryptoAsset {
  const asset = CRYPTO_ASSETS.find((a) => a.symbol === symbol);
  if (!asset) throw new Error(`${symbol} is not a listed crypto asset`);
  return asset;
}

/** The Hyperliquid coin to quote and calibrate `symbol` on. */
export function coinOf(symbol: string): string {
  const asset = cryptoAsset(symbol);
  return asset.coin ?? asset.symbol;
}

/**
 * Refuses a registry the program could not store or the lambdas could not
 * serve, at load time rather than at 03:00 when the first market fails.
 */
export function validateCryptoAssets(assets: readonly CryptoAsset[]): void {
  if (assets.length === 0) throw new Error("CRYPTO_ASSETS is empty");

  const seen = new Set<string>();
  for (const asset of assets) {
    if (!/^[A-Z0-9]{1,8}$/.test(asset.symbol)) {
      throw new Error(`${asset.symbol}: a symbol is 1 to 8 uppercase ASCII letters or digits`);
    }
    if (seen.has(asset.symbol)) throw new Error(`${asset.symbol} is listed twice`);
    seen.add(asset.symbol);

    if (!asset.hourly && asset.dailyRungs.length === 0) {
      throw new Error(`${asset.symbol} lists neither hourly nor daily markets`);
    }
    if (new Set(asset.dailyRungs).size !== asset.dailyRungs.length) {
      throw new Error(`${asset.symbol} repeats a daily rung`);
    }
    if (asset.coin !== undefined && asset.coin.length === 0) {
      throw new Error(`${asset.symbol}: an explicit coin must not be empty`);
    }
  }
}

validateCryptoAssets(CRYPTO_ASSETS);
