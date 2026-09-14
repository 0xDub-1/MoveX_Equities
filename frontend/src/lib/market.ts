// =============================================================================
// Market model
// =============================================================================
//
// Everything the UI knows about a market is decoded from its on-chain account
// into a plain view object here, once, so no component has to know that a
// pool is a BN or that a tier arrives as `{ fair: {} }`.
//
// The arithmetic mirrors the program (oracle.rs, payout.rs, settle.rs) so the
// number a user sees before claiming is the number the program pays.

import type { PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";

import { bytesToString, type Tier } from "./pda";

export type { Tier };
export type Side = "above" | "below";
export type MarketState = "open" | "locked" | "settled" | "voided";
export type MarketKind = "daily" | "hourly";

/**
 * Where a market is in its life, as seen from the wall clock. Finer than the
 * on-chain state: an Open market past its lock time is waiting on the crank,
 * which is a different situation from one still taking deposits.
 */
export type MarketPhase =
  | "deposits"
  | "awaiting-lock"
  | "live"
  | "awaiting-settle"
  | "settled"
  | "voided";

export interface MarketView {
  address: PublicKey;
  /** base58 of `address`, for keys and links. */
  key: string;
  symbol: string;
  /** `2026-09-16` for a daily market, `0916-1000` for an hourly one. */
  sessionId: string;
  kind: MarketKind;
  tier: Tier;
  strikeBps: number;
  samplesBps: number[];
  state: MarketState;
  /** Scaled by 1e8. Zero until lock. */
  referencePrice: bigint;
  /** Scaled by 1e8. Zero until settle. */
  settlementPrice: bigint;
  /** USDX base units. */
  abovePool: bigint;
  belowPool: bigint;
  winningSide: Side | null;
  feeBps: number;
  lockTs: number;
  settleTs: number;
  priceFeed: PublicKey;
  vault: PublicKey;
  quoteMint: PublicKey;
  treasury: PublicKey;
  feeCollected: boolean;
}

export interface PositionView {
  address: PublicKey;
  key: string;
  owner: PublicKey;
  market: PublicKey;
  marketKey: string;
  side: Side;
  /** USDX base units. */
  amount: bigint;
  claimed: boolean;
}

export interface PriceFeedView {
  address: PublicKey;
  symbol: string;
  /** Scaled by 1e8. */
  price: bigint;
  conf: bigint;
  /** Unix seconds, when the source produced the price. */
  publishTime: number;
  postedSlot: number;
  sourceCount: number;
  publisher: PublicKey;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

type RawEnum = Record<string, unknown>;

interface RawMarket {
  underlying: number[];
  sessionDate: number[];
  tier: RawEnum;
  pythFeed: PublicKey;
  quoteMint: PublicKey;
  vault: PublicKey;
  strikeBps: number;
  samplesBps: number[];
  state: RawEnum;
  referencePrice: BN;
  settlementPrice: BN;
  abovePool: BN;
  belowPool: BN;
  winningSide: RawEnum | null;
  feeBps: number;
  treasury: PublicKey;
  feeCollected: boolean;
  lockTs: BN;
  settleTs: BN;
}

interface RawPosition {
  owner: PublicKey;
  market: PublicKey;
  side: RawEnum;
  amount: BN;
  claimed: boolean;
}

interface RawPriceFeed {
  underlying: number[];
  publisher: PublicKey;
  price: BN;
  conf: BN;
  publishTime: BN;
  postedSlot: BN;
  sourceCount: number;
}

/** Anchor decodes a unit enum as `{ variant: {} }`. */
function enumKey<T extends string>(value: RawEnum): T {
  return Object.keys(value)[0] as T;
}

function big(value: BN): bigint {
  return BigInt(value.toString());
}

export function kindOf(sessionId: string): MarketKind {
  return sessionId.length === 10 ? "daily" : "hourly";
}

export function decodeMarket(address: PublicKey, raw: RawMarket): MarketView {
  const sessionId = bytesToString(raw.sessionDate);
  return {
    address,
    key: address.toBase58(),
    symbol: bytesToString(raw.underlying),
    sessionId,
    kind: kindOf(sessionId),
    tier: enumKey<Tier>(raw.tier),
    strikeBps: raw.strikeBps,
    samplesBps: [...raw.samplesBps],
    state: enumKey<MarketState>(raw.state),
    referencePrice: big(raw.referencePrice),
    settlementPrice: big(raw.settlementPrice),
    abovePool: big(raw.abovePool),
    belowPool: big(raw.belowPool),
    winningSide: raw.winningSide ? enumKey<Side>(raw.winningSide) : null,
    feeBps: raw.feeBps,
    lockTs: Number(raw.lockTs.toString()),
    settleTs: Number(raw.settleTs.toString()),
    priceFeed: raw.pythFeed,
    vault: raw.vault,
    quoteMint: raw.quoteMint,
    treasury: raw.treasury,
    feeCollected: raw.feeCollected,
  };
}

export function decodePosition(address: PublicKey, raw: RawPosition): PositionView {
  return {
    address,
    key: address.toBase58(),
    owner: raw.owner,
    market: raw.market,
    marketKey: raw.market.toBase58(),
    side: enumKey<Side>(raw.side),
    amount: big(raw.amount),
    claimed: raw.claimed,
  };
}

export function decodePriceFeed(address: PublicKey, raw: RawPriceFeed): PriceFeedView {
  return {
    address,
    symbol: bytesToString(raw.underlying),
    price: big(raw.price),
    conf: big(raw.conf),
    publishTime: Number(raw.publishTime.toString()),
    postedSlot: Number(raw.postedSlot.toString()),
    sourceCount: raw.sourceCount,
    publisher: raw.publisher,
  };
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const TIERS: readonly Tier[] = ["tight", "fair", "wide"];

export const TIER_META: Record<
  Tier,
  {
    label: string;
    percentile: string;
    ordinal: string;
    baseRate: number;
    question: string;
    note: string;
  }
> = {
  tight: {
    label: "TIGHT",
    percentile: "P25",
    ordinal: "25th",
    baseRate: 75,
    question: "Does it move at all?",
    note: "Exceeded on about three sessions in four.",
  },
  fair: {
    label: "FAIR",
    percentile: "P50",
    ordinal: "50th",
    baseRate: 50,
    question: "Coin flip.",
    note: "Exceeded on about half of recent sessions.",
  },
  wide: {
    label: "WIDE",
    percentile: "P75",
    ordinal: "75th",
    baseRate: 25,
    question: "Is today a big one?",
    note: "Exceeded on about one session in four.",
  },
};

/**
 * How the two sides are spoken of in the interface.
 *
 * Every market is a yes or no question, "will it move more than this?", so
 * the sides are YES and NO. The program calls them Above and Below; that
 * name survives only as `chain`, for the details panel and the explorer.
 */
export const SIDE_META: Record<
  Side,
  { label: string; chain: string; short: string; description: string }
> = {
  above: {
    label: "YES",
    chain: "ABOVE",
    short: "Moves more",
    description: "The stock moves more than the threshold, up or down.",
  },
  below: {
    label: "NO",
    chain: "BELOW",
    short: "Stays within",
    description: "The stock stays within the threshold. An exact tie counts as NO.",
  },
};

/** How many of the stored samples cleared this market's threshold. */
export function samplesCleared(m: MarketView): number {
  return m.samplesBps.filter((s) => s > m.strikeBps).length;
}

// ---------------------------------------------------------------------------
// Phase and timing
// ---------------------------------------------------------------------------

export function phaseOf(m: MarketView, nowSec: number): MarketPhase {
  switch (m.state) {
    case "open":
      return nowSec < m.lockTs ? "deposits" : "awaiting-lock";
    case "locked":
      return nowSec < m.settleTs ? "live" : "awaiting-settle";
    case "settled":
      return "settled";
    case "voided":
      return "voided";
  }
}

export const PHASE_META: Record<MarketPhase, { label: string; tone: Tone }> = {
  deposits: { label: "Open", tone: "brand" },
  "awaiting-lock": { label: "Locking", tone: "amber" },
  live: { label: "Live", tone: "sky" },
  "awaiting-settle": { label: "Settling", tone: "amber" },
  settled: { label: "Settled", tone: "neutral" },
  voided: { label: "Voided", tone: "rose" },
};

export type Tone = "brand" | "sky" | "amber" | "rose" | "neutral";

/** Whether the market accepts deposits and withdrawals right now. */
export function isDepositable(m: MarketView, nowSec: number): boolean {
  return m.state === "open" && nowSec < m.lockTs;
}

export function isResolved(m: MarketView): boolean {
  return m.state === "settled" || m.state === "voided";
}

// ---------------------------------------------------------------------------
// Prices and moves
// ---------------------------------------------------------------------------

const PRICE_SCALE = 100_000_000n;

export function priceToNumber(scaled: bigint): number {
  return Number(scaled) / Number(PRICE_SCALE);
}

/**
 * Absolute move in basis points, exactly as settle.rs computes it: integer
 * maths, truncating, direction discarded.
 */
export function moveBps(reference: bigint, price: bigint): number {
  if (reference === 0n) return 0;
  const diff = price >= reference ? price - reference : reference - price;
  return Number((diff * 10_000n) / reference);
}

/** Signed move as a percentage, for display only. */
export function signedMovePct(reference: bigint, price: bigint): number {
  if (reference === 0n) return 0;
  return (Number(price - reference) / Number(reference)) * 100;
}

/** The side that would win if the market settled at `price` right now. */
export function sideAt(m: MarketView, price: bigint): Side {
  return moveBps(m.referencePrice, price) > m.strikeBps ? "above" : "below";
}

/**
 * Which side is ahead. Settled markets answer from the record; live ones
 * from the latest oracle price; open ones have no reference yet.
 */
export function leadingSide(m: MarketView, livePrice: bigint | undefined): Side | null {
  if (m.state === "settled") return m.winningSide;
  if (m.state === "locked" && livePrice !== undefined && m.referencePrice > 0n) {
    return sideAt(m, livePrice);
  }
  return null;
}

/** The two prices the threshold sits at, around a reference. */
export function thresholdPrices(reference: bigint, strikeBps: number): { lower: number; upper: number } {
  const ref = priceToNumber(reference);
  const k = strikeBps / 10_000;
  return { lower: ref * (1 - k), upper: ref * (1 + k) };
}

// ---------------------------------------------------------------------------
// Pools and payouts
// ---------------------------------------------------------------------------

export function pot(m: MarketView): bigint {
  return m.abovePool + m.belowPool;
}

export function poolOf(m: MarketView, side: Side): bigint {
  return side === "above" ? m.abovePool : m.belowPool;
}

/** Fraction of the pot sitting on `side`, 0..1. Zero on an empty market. */
export function poolShare(m: MarketView, side: Side): number {
  const total = pot(m);
  if (total === 0n) return 0;
  return Number(poolOf(m, side)) / Number(total);
}

/** payout.rs: the pot less the fee, truncating. */
export function distributable(total: bigint, feeBps: number): bigint {
  return total - (total * BigInt(feeBps)) / 10_000n;
}

/**
 * What one USDX on `side` returns if that side wins, after adding `extra`
 * to that side. Null when nothing sits on the side, since a share of an
 * empty pool is undefined.
 */
export function payoutMultiple(m: MarketView, side: Side, extra = 0n): number | null {
  const sidePool = poolOf(m, side) + extra;
  if (sidePool === 0n) return null;
  const total = pot(m) + extra;
  return Number(distributable(total, m.feeBps)) / Number(sidePool);
}

/**
 * The claim the program would pay for `position`: the full stake on a voided
 * market, the pro-rata share on a settled one it won, nothing otherwise.
 */
export function claimAmount(m: MarketView, position: PositionView): bigint {
  if (position.claimed || position.amount === 0n) return 0n;
  if (m.state === "voided") return position.amount;
  if (m.state !== "settled" || !m.winningSide) return 0n;
  if (position.side !== m.winningSide) return 0n;
  const winningPool = poolOf(m, m.winningSide);
  if (winningPool === 0n) return 0n;
  return (position.amount * distributable(pot(m), m.feeBps)) / winningPool;
}

/** Realised outcome of a position on a resolved market, in base units. */
export function positionPnl(m: MarketView, position: PositionView): bigint | null {
  if (!isResolved(m) || position.amount === 0n) return null;
  if (m.state === "voided") return 0n;
  if (position.side !== m.winningSide) return -position.amount;
  const winningPool = poolOf(m, m.winningSide);
  if (winningPool === 0n) return 0n;
  return (position.amount * distributable(pot(m), m.feeBps)) / winningPool - position.amount;
}

// ---------------------------------------------------------------------------
// Labels and grouping
// ---------------------------------------------------------------------------

/** Groups the rungs of one ladder: same ticker, same session. */
export function ladderId(m: MarketView): string {
  return `${m.symbol}|${m.sessionId}`;
}

export const TIER_ORDER: Record<Tier, number> = { tight: 0, fair: 1, wide: 2 };

export function byLockThenTier(a: MarketView, b: MarketView): number {
  if (a.lockTs !== b.lockTs) return a.lockTs - b.lockTs;
  if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
}

export function bySettleDesc(a: MarketView, b: MarketView): number {
  if (a.settleTs !== b.settleTs) return b.settleTs - a.settleTs;
  if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
}
