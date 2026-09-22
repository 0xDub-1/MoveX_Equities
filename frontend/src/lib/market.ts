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

import { CRANK_GRACE_SECS, VOID_GRACE_SECS } from "./config";
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
  /** Missed its moment by too much to resolve. Refunds once anyone voids it. */
  | "expired"
  | "settled"
  | "voided";

/**
 * Deposits that arrived after lock, reduced to the three integers the payout
 * needs. Kept on the market per side and on each position for its own share,
 * accumulated with exactly the same terms, so every division at claim time
 * is by a sum of what it distributes. Mirrors `LiveTotals` in state.rs.
 */
export interface LiveTotals {
  /** USDX base units. */
  amount: bigint;
  /** The least this money is paid back if its side wins: amount less fee. */
  floor: bigint;
  /** How much more its cap allows. Decays with the time left at deposit. */
  excess: bigint;
}

export const EMPTY_LIVE: LiveTotals = { amount: 0n, floor: 0n, excess: 0n };

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
  /** The part of each pool that arrived after lock, with its cap. */
  liveAbove: LiveTotals;
  liveBelow: LiveTotals;
  /** Whether deposits stay open after lock. */
  liveDeposits: boolean;
  /** Most a live deposit may be paid, in bps of itself, just after lock. */
  liveMaxMultipleBps: number;
  /** How fast that maximum decays across the window. Zero is flat. */
  liveCapExp: number;
  /** Live deposits close this many seconds before settlement. */
  liveCutoffSecs: number;
}

export interface PositionView {
  address: PublicKey;
  key: string;
  owner: PublicKey;
  market: PublicKey;
  marketKey: string;
  side: Side;
  /** USDX base units, before and after lock. */
  amount: bigint;
  /** The part of `amount` that arrived after lock, with its cap. */
  live: LiveTotals;
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

interface RawLive {
  amount: BN;
  floor: BN;
  excess: BN;
}

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
  liveAbove: RawLive;
  liveBelow: RawLive;
  liveDeposits: boolean;
  liveMaxMultipleBps: number;
  liveCapExp: number;
  liveCutoffSecs: number;
}

interface RawPosition {
  owner: PublicKey;
  market: PublicKey;
  side: RawEnum;
  amount: BN;
  live: RawLive;
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

function decodeLive(raw: RawLive): LiveTotals {
  return { amount: big(raw.amount), floor: big(raw.floor), excess: big(raw.excess) };
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
    liveAbove: decodeLive(raw.liveAbove),
    liveBelow: decodeLive(raw.liveBelow),
    liveDeposits: raw.liveDeposits,
    liveMaxMultipleBps: raw.liveMaxMultipleBps,
    liveCapExp: raw.liveCapExp,
    liveCutoffSecs: raw.liveCutoffSecs,
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
    live: decodeLive(raw.live),
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

/**
 * The top of a samples chart. Capped just above the bulk of the distribution
 * rather than at its tallest bar, because one outlying move would otherwise
 * flatten the other nineteen and bury the threshold line at the floor. Bars
 * past the cap simply reach the top, which is what they mean anyway.
 */
export function sampleScale(samplesBps: readonly number[], strikeBps: number): number {
  const ranked = [...samplesBps].sort((a, b) => a - b);
  const p85 = ranked[Math.max(0, Math.ceil(ranked.length * 0.85) - 1)] ?? 0;
  return Math.max(p85, strikeBps * 1.4, 1) * 1.1;
}

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

/**
 * Where a market stands, from the wall clock rather than its stored state.
 *
 * Finer than the on-chain state in two ways. An Open market past its lock
 * time is waiting on the crank, which is not the same as taking deposits.
 * And once it is far enough past that the crank has given up, it can no
 * longer lock at all: the only move left is a refund, so it stops claiming
 * to be about to lock.
 */
export function phaseOf(m: MarketView, nowSec: number): MarketPhase {
  switch (m.state) {
    case "open":
      if (nowSec < m.lockTs) return "deposits";
      return nowSec > m.lockTs + CRANK_GRACE_SECS ? "expired" : "awaiting-lock";
    case "locked":
      if (nowSec < m.settleTs) return "live";
      return nowSec > m.settleTs + CRANK_GRACE_SECS ? "expired" : "awaiting-settle";
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
  expired: { label: "Expired", tone: "rose" },
  settled: { label: "Settled", tone: "neutral" },
  voided: { label: "Voided", tone: "rose" },
};

/** When a market that can no longer resolve becomes refundable to anyone. */
export function refundableAt(m: MarketView): number {
  return m.settleTs + VOID_GRACE_SECS;
}

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

/** How far the stock has to travel from `reference` to clear the threshold. */
export function strikeDistance(reference: bigint, strikeBps: number): number {
  return priceToNumber(reference) * (strikeBps / 10_000);
}

/** The two prices the threshold sits at, around a reference. */
export function thresholdPrices(reference: bigint, strikeBps: number): { lower: number; upper: number } {
  const ref = priceToNumber(reference);
  const d = strikeDistance(reference, strikeBps);
  return { lower: ref - d, upper: ref + d };
}

export interface StrikeBand {
  /** Below this price, YES wins. */
  lower: number;
  /** Above this price, YES wins. */
  upper: number;
  /** The price the two ends are measured from. */
  anchor: number;
  /** Half the band, which is what the stock has to travel, in dollars. */
  distance: number;
  /** True while the anchor is the live print rather than a recorded reference. */
  provisional: boolean;
}

/**
 * A market's threshold said in prices rather than in a percentage.
 *
 * Nobody holds a percentage, so this is the form the question is actually
 * asked in: two prices, and the one they are measured from.
 *
 * Before lock there is no reference yet and the band is drawn around the live
 * print, moving with it until the moment it is recorded. That is what
 * `provisional` says, rather than passing a moving number off as a strike.
 *
 * Null when there is nothing honest to draw: no reference, and no lock left
 * to record one at.
 */
export function strikeBand(m: MarketView, livePrice: bigint | undefined): StrikeBand | null {
  const provisional = m.referencePrice <= 0n;
  const reference = provisional ? livePrice : m.referencePrice;
  if (provisional && m.state !== "open") return null;
  if (reference === undefined || reference <= 0n) return null;

  const { lower, upper } = thresholdPrices(reference, m.strikeBps);
  return {
    lower,
    upper,
    anchor: priceToNumber(reference),
    distance: strikeDistance(reference, m.strikeBps),
    provisional,
  };
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

// ---------------------------------------------------------------------------
// Live round
// ---------------------------------------------------------------------------
//
// Deposits after lock. Money that arrives after the reference price is known
// never dilutes the money that was there before it; beyond that the pools
// decide. Each function here mirrors its namesake in payout.rs, in the same
// integer arithmetic, so what the panel projects is what the program pays.

const BPS = 10_000n;

const bigMin = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function liveOf(m: MarketView, side: Side): LiveTotals {
  return side === "above" ? m.liveAbove : m.liveBelow;
}

/** Whether a deposit made now would land in the live round. */
export function liveDepositsOpen(m: MarketView, nowSec: number): boolean {
  return m.state === "locked" && m.liveDeposits && nowSec < m.settleTs - m.liveCutoffSecs;
}

/**
 * payout.rs `live_multiple_bps`: the most a live deposit made now may be
 * paid, in basis points of itself. `max` just after lock, `1 - fee` at
 * settlement, shaped by the exponent between.
 */
export function liveMultipleBps(m: MarketView, nowSec: number): number {
  const window = m.settleTs - m.lockTs;
  if (window <= 0) return 10_000 - m.feeBps;
  const remaining = Math.max(0, Math.min(window, m.settleTs - nowSec));
  const fBps = Math.floor((remaining * 10_000) / window);
  let fPow = 10_000;
  for (let i = 0; i < m.liveCapExp; i++) fPow = Math.floor((fPow * fBps) / 10_000);
  const base = 10_000 - m.feeBps;
  return base + Math.floor(((m.liveMaxMultipleBps - base) * fPow) / 10_000);
}

/** payout.rs `live_terms`: what a live deposit is recorded as. */
export function liveTerms(amount: bigint, feeBps: number, multipleBps: number): LiveTotals {
  const floor = (amount * (BPS - BigInt(feeBps))) / BPS;
  const cap = (amount * BigInt(multipleBps)) / BPS;
  return { amount, floor, excess: cap > floor ? cap - floor : 0n };
}

/** payout.rs `live_group`: what the winning side's live money is paid as a group. */
export function liveGroup(dist: bigint, winningPool: bigint, live: LiveTotals): bigint {
  if (live.amount === 0n) return 0n;
  if (winningPool - live.amount === 0n) return dist;
  const raw = (dist * live.amount) / winningPool;
  return bigMin(raw, live.floor + live.excess);
}

/** payout.rs `payout_live`: one live position's share of its group. */
export function payoutLive(position: LiveTotals, group: bigint, pool: LiveTotals): bigint {
  const floorLayer = bigMin(group, pool.floor);
  const excessLayer = group - floorLayer;
  const first = pool.floor > 0n ? (position.floor * floorLayer) / pool.floor : 0n;
  const second =
    pool.excess > 0n
      ? (position.excess * excessLayer) / pool.excess
      : pool.amount > 0n
        ? (position.amount * excessLayer) / pool.amount
        : 0n;
  return first + second;
}

/**
 * What the program pays for `position` on a resolved market, whether or not
 * it has been claimed: the full stake on a voided market, the pre-lock and
 * live shares on a settled one it won, nothing otherwise.
 */
export function claimValue(m: MarketView, position: PositionView): bigint {
  if (position.amount === 0n) return 0n;
  if (m.state === "voided") return position.amount;
  if (m.state !== "settled" || !m.winningSide) return 0n;
  if (position.side !== m.winningSide) return 0n;

  const winner = m.winningSide;
  const dist = distributable(pot(m), m.feeBps);
  const winningPool = poolOf(m, winner);
  const livePool = liveOf(m, winner);
  const group = liveGroup(dist, winningPool, livePool);

  const preLockPool = winningPool - livePool.amount;
  const preLockAmount = position.amount - position.live.amount;

  let total = 0n;
  if (preLockAmount > 0n && preLockPool > 0n) {
    total += (preLockAmount * (dist - group)) / preLockPool;
  }
  if (position.live.amount > 0n) {
    total += payoutLive(position.live, group, livePool);
  }
  return total;
}

/** What a claim pays right now. Zero once claimed. */
export function claimAmount(m: MarketView, position: PositionView): bigint {
  if (position.claimed) return 0n;
  return claimValue(m, position);
}

/** Realised outcome of a position on a resolved market, in base units. */
export function positionPnl(m: MarketView, position: PositionView): bigint | null {
  if (!isResolved(m) || position.amount === 0n) return null;
  if (m.state === "voided") return 0n;
  if (position.side !== m.winningSide) return -position.amount;
  return claimValue(m, position) - position.amount;
}

/**
 * What a deposit of `amount` on `side` made now would be paid if that side
 * won with the pools as they stand. Before lock that is the pro-rata share;
 * in the live round it is the same share held under the deposit's cap.
 * Null when nothing would sit on the side.
 */
export function projectedPayout(
  m: MarketView,
  side: Side,
  amount: bigint,
  nowSec: number,
): bigint | null {
  if (amount <= 0n) return null;
  const dist = distributable(pot(m) + amount, m.feeBps);
  const winningPool = poolOf(m, side) + amount;
  if (winningPool === 0n) return null;

  if (!liveDepositsOpen(m, nowSec)) {
    return (amount * dist) / winningPool;
  }

  const terms = liveTerms(amount, m.feeBps, liveMultipleBps(m, nowSec));
  const current = liveOf(m, side);
  const livePool: LiveTotals = {
    amount: current.amount + terms.amount,
    floor: current.floor + terms.floor,
    excess: current.excess + terms.excess,
  };
  const group = liveGroup(dist, winningPool, livePool);
  return payoutLive(terms, group, livePool);
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
