// =============================================================================
// Asset registry
// =============================================================================
//
// Every underlying the interface knows, with the venue it trades on. The
// keeper's own lists (config.ts and crypto-config.ts) decide what exists on
// chain; this one decides how it is shown and where. Listing an asset the
// keeper has started serving is one line here.
//
// A market whose symbol is not in this list is not shown anywhere. Anyone
// can create a market on the program, and a board that listed whatever it
// found would be a board anyone could write on.

import { isVenueListed, type Venue } from "./venue";

export interface AssetInfo {
  /** The on-chain underlying, up to 8 ASCII characters. */
  symbol: string;
  name: string;
  venue: Venue;
  /** Whether the asset carries hourly markets. */
  hourly: boolean;
}

export const ASSETS: readonly AssetInfo[] = [
  { symbol: "NVDA", name: "NVIDIA", venue: "equities", hourly: true },
  { symbol: "TSLA", name: "Tesla", venue: "equities", hourly: false },
  { symbol: "SPY", name: "S&P 500 ETF", venue: "equities", hourly: false },
  { symbol: "BTC", name: "Bitcoin", venue: "crypto", hourly: true },
  { symbol: "ETH", name: "Ether", venue: "crypto", hourly: false },
  { symbol: "SOL", name: "Solana", venue: "crypto", hourly: false },
];

/**
 * ASSETS is the whole catalogue; this is the part of it this deployment
 * shows. A market on an unlisted venue is treated exactly like a market on an
 * unknown symbol: it does not appear anywhere.
 */
const LISTED: readonly AssetInfo[] = ASSETS.filter((a) => isVenueListed(a.venue));

const BY_SYMBOL: ReadonlyMap<string, AssetInfo> = new Map(LISTED.map((a) => [a.symbol, a]));

export function assetInfo(symbol: string): AssetInfo | undefined {
  return BY_SYMBOL.get(symbol);
}

export function isListed(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

export function assetsOf(venue: Venue): AssetInfo[] {
  return LISTED.filter((a) => a.venue === venue);
}

export function symbolsOf(venue: Venue): string[] {
  return assetsOf(venue).map((a) => a.symbol);
}

/** Every listed symbol, in display order. */
export const ALL_SYMBOLS: readonly string[] = LISTED.map((a) => a.symbol);

/** The venue a symbol trades on. Equities for anything unknown, which never reaches a page. */
export function venueOfSymbol(symbol: string): Venue {
  return BY_SYMBOL.get(symbol)?.venue ?? "equities";
}

export function assetName(symbol: string): string | undefined {
  return BY_SYMBOL.get(symbol)?.name;
}
