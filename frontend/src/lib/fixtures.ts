// =============================================================================
// Fixtures for the design preview
// =============================================================================
//
// Fabricated markets in every phase, on both venues, so the components can
// be looked at before the keeper has posted anything. Used only by the
// development-only /preview route; nothing in the app reads these.

import { PublicKey } from "@solana/web3.js";

import { QUOTE_MINT } from "./config";
import type { MarketView, PriceFeedView, PositionView, Side, Tier } from "./market";
import { marketPda, priceFeedPda, vaultPda } from "./pda";

const NVDA_SAMPLES = [3, 6, 7, 33, 84, 91, 98, 99, 148, 151, 159, 180, 201, 219, 234, 237, 291, 321, 457, 874];
const TSLA_SAMPLES = [12, 40, 55, 70, 120, 140, 160, 180, 210, 240, 260, 290, 310, 340, 380, 420, 480, 560, 700, 910];
const SPY_SAMPLES = [2, 5, 9, 14, 21, 28, 33, 40, 48, 55, 61, 70, 82, 95, 110, 128, 150, 172, 210, 260];
const HOURLY_SAMPLES = [2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 15, 17, 19, 22, 25, 28, 32, 38, 45, 60];

// The crypto tape on 21 September 2026: BTC hourly moves in basis points, the
// daily ladders of ETH and SOL.
const BTC_HOURLY_SAMPLES = [1, 2, 5, 6, 10, 13, 13, 15, 17, 19, 19, 22, 22, 23, 24, 30, 37, 55, 55, 77];
const ETH_DAILY_SAMPLES = [19, 40, 52, 69, 75, 86, 100, 103, 113, 119, 122, 142, 157, 196, 199, 210, 321, 469, 487, 681];
const SOL_DAILY_SAMPLES = [10, 40, 46, 68, 122, 146, 172, 184, 195, 245, 262, 291, 297, 302, 331, 333, 352, 388, 556, 1097];

const STRIKES: Record<Tier, (s: number[]) => number> = {
  tight: (s) => Math.floor((s[4] * 25 + s[5] * 75) / 100),
  fair: (s) => Math.floor((s[9] * 50 + s[10] * 50) / 100),
  wide: (s) => Math.floor((s[14] * 75 + s[15] * 25) / 100),
};

const USDX = 1_000_000n;
const P = 100_000_000n;

function market(
  symbol: string,
  sessionId: string,
  tier: Tier,
  samples: number[],
  fields: Partial<MarketView>,
): MarketView {
  const address = marketPda(symbol, sessionId, tier);
  return {
    address,
    key: address.toBase58(),
    symbol,
    sessionId,
    kind: sessionId.length === 10 ? "daily" : "hourly",
    tier,
    strikeBps: STRIKES[tier](samples),
    samplesBps: samples,
    state: "open",
    referencePrice: 0n,
    settlementPrice: 0n,
    abovePool: 0n,
    belowPool: 0n,
    winningSide: null,
    feeBps: 100,
    lockTs: 0,
    settleTs: 0,
    priceFeed: priceFeedPda(symbol),
    vault: vaultPda(address),
    quoteMint: QUOTE_MINT,
    treasury: PublicKey.default,
    feeCollected: false,
    liveAbove: { amount: 0n, floor: 0n, excess: 0n },
    liveBelow: { amount: 0n, floor: 0n, excess: 0n },
    liveDeposits: true,
    liveMaxMultipleBps: 20_000,
    liveCapExp: 2,
    liveCutoffSecs: 120,
    ...fields,
  };
}

export function fixtureMarkets(now: number): MarketView[] {
  const hour = 3600;
  const day = 86_400;
  const out: MarketView[] = [];

  // NVDA daily ladder, open, locking tomorrow at the close.
  for (const tier of ["tight", "fair", "wide"] as Tier[]) {
    out.push(
      market("NVDA", "2026-09-16", tier, NVDA_SAMPLES, {
        lockTs: now + 22 * hour,
        settleTs: now + 46 * hour,
        abovePool: tier === "fair" ? 7_400n * USDX : tier === "tight" ? 4_100n * USDX : 2_300n * USDX,
        belowPool: tier === "fair" ? 5_600n * USDX : tier === "tight" ? 3_800n * USDX : 3_900n * USDX,
      }),
    );
  }

  // TSLA daily ladder, live, measuring against a reference of 241.10.
  for (const tier of ["tight", "fair", "wide"] as Tier[]) {
    out.push(
      market("TSLA", "2026-09-15", tier, TSLA_SAMPLES, {
        state: "locked",
        lockTs: now - 2 * hour,
        settleTs: now + 22 * hour,
        referencePrice: 24_110n * P / 100n,
        abovePool: 6_200n * USDX,
        belowPool: 5_100n * USDX,
      }),
    );
  }

  // SPY daily ladder, settled, BELOW won on TIGHT and FAIR, ABOVE on nothing.
  for (const tier of ["tight", "fair", "wide"] as Tier[]) {
    out.push(
      market("SPY", "2026-09-14", tier, SPY_SAMPLES, {
        state: "settled",
        lockTs: now - day - 2 * hour,
        settleTs: now - 2 * hour,
        referencePrice: 65_231n * P / 100n,
        settlementPrice: 65_412n * P / 100n,
        winningSide: tier === "tight" ? "above" : "below",
        abovePool: 3_300n * USDX,
        belowPool: 4_700n * USDX,
      }),
    );
  }

  // NVDA hourly session: two settled, one live, three open.
  const slots = [10, 11, 12, 13, 14, 15];
  const sessionStart = now - 2 * hour - 20 * 60;
  slots.forEach((h, i) => {
    const lockTs = sessionStart + i * hour;
    const settleTs = lockTs + hour;
    const phase = i < 2 ? "settled" : i === 2 ? "locked" : "open";
    out.push(
      market("NVDA", `0914-${h}00`, "fair", HOURLY_SAMPLES, {
        state: phase,
        lockTs,
        settleTs,
        referencePrice: phase === "open" ? 0n : 21_829n * P / 100n,
        settlementPrice: phase === "settled" ? (i === 0 ? 21_869n : 21_812n) * P / 100n : 0n,
        winningSide: phase === "settled" ? (i === 0 ? "above" : "below") : null,
        abovePool: (900n + BigInt(i) * 150n) * USDX,
        belowPool: (1_100n - BigInt(i) * 80n) * USDX,
      }),
    );
  });

  // BTC hourly day: two settled, one live, four open, each hour calibrated on
  // its own, so the thresholds differ from row to row.
  const btcStart = now - 2 * hour - 20 * 60;
  [10, 11, 12, 13, 14, 15, 16].forEach((h, i) => {
    const lockTs = btcStart + i * hour;
    const settleTs = lockTs + hour;
    const phase = i < 2 ? "settled" : i === 2 ? "locked" : "open";
    const samples = BTC_HOURLY_SAMPLES.map((s) => s + i * 2);
    out.push(
      market("BTC", `260921-${String(h).padStart(2, "0")}`, "fair", samples, {
        state: phase,
        lockTs,
        settleTs,
        referencePrice: phase === "open" ? 0n : 81_234_50n * P / 100n,
        settlementPrice: phase === "settled" ? (i === 0 ? 81_410_00n : 81_190_00n) * P / 100n : 0n,
        winningSide: phase === "settled" ? (i === 0 ? "above" : "below") : null,
        abovePool: (700n + BigInt(i) * 120n) * USDX,
        belowPool: (900n - BigInt(i) * 60n) * USDX,
      }),
    );
  });

  // ETH daily ladder, open, locking at the next midnight UTC.
  for (const tier of ["tight", "fair", "wide"] as Tier[]) {
    out.push(
      market("ETH", "2026-09-22", tier, ETH_DAILY_SAMPLES, {
        lockTs: now + 9 * hour,
        settleTs: now + 33 * hour,
        abovePool: tier === "fair" ? 2_900n * USDX : 1_600n * USDX,
        belowPool: tier === "fair" ? 2_400n * USDX : 1_900n * USDX,
      }),
    );
  }

  // SOL daily ladder, live since midnight, measuring against 111.35.
  for (const tier of ["tight", "fair", "wide"] as Tier[]) {
    out.push(
      market("SOL", "2026-09-21", tier, SOL_DAILY_SAMPLES, {
        state: "locked",
        lockTs: now - 15 * hour,
        settleTs: now + 9 * hour,
        referencePrice: 11_135n * P / 100n,
        abovePool: 2_100n * USDX,
        belowPool: 1_700n * USDX,
      }),
    );
  }

  return out;
}

export function fixtureFeeds(now: number): Record<string, PriceFeedView> {
  const feed = (symbol: string, price: number): PriceFeedView => ({
    address: priceFeedPda(symbol),
    symbol,
    price: BigInt(Math.round(price * 100)) * P / 100n,
    conf: 2_000_000n,
    publishTime: now - 40,
    postedSlot: 0,
    sourceCount: 1,
    publisher: PublicKey.default,
  });
  return {
    NVDA: feed("NVDA", 218.64),
    TSLA: feed("TSLA", 245.9),
    SPY: feed("SPY", 654.12),
    BTC: feed("BTC", 81_301.5),
    ETH: feed("ETH", 2_657.95),
    SOL: feed("SOL", 111.61),
  };
}

export function fixturePosition(m: MarketView, side: Side, amount: bigint): PositionView {
  return {
    address: PublicKey.default,
    key: `pos-${m.key}`,
    owner: PublicKey.default,
    market: m.address,
    marketKey: m.key,
    side,
    amount,
    live: { amount: 0n, floor: 0n, excess: 0n },
    claimed: false,
  };
}
