// =============================================================================
// Payout mirror check
// =============================================================================
//
// The panel projects payouts with a bigint mirror of payout.rs. This runs that
// mirror against the numbers the program tests pin, so a drift between the
// two shows up here rather than as a claim that pays less than it promised.
//
//   npx tsx scripts/verify-payout.ts
import { PublicKey } from "@solana/web3.js";
import {
  claimValue,
  liveMultipleBps,
  liveTerms,
  projectedPayout,
  type LiveTotals,
  type MarketView,
  type PositionView,
} from "../src/lib/market";

const USDC = 1_000_000n;
const ZERO: LiveTotals = { amount: 0n, floor: 0n, excess: 0n };
const add = (a: LiveTotals, b: LiveTotals): LiveTotals => ({
  amount: a.amount + b.amount,
  floor: a.floor + b.floor,
  excess: a.excess + b.excess,
});

function market(over: Partial<MarketView>): MarketView {
  return {
    address: PublicKey.default,
    key: "m",
    symbol: "NVDA",
    sessionId: "2026-09-22",
    kind: "hourly",
    tier: "fair",
    strikeBps: 155,
    samplesBps: [],
    state: "locked",
    referencePrice: 21_829n,
    settlementPrice: 0n,
    abovePool: 0n,
    belowPool: 0n,
    winningSide: null,
    feeBps: 100,
    lockTs: 0,
    settleTs: 3_600,
    priceFeed: PublicKey.default,
    vault: PublicKey.default,
    quoteMint: PublicKey.default,
    treasury: PublicKey.default,
    feeCollected: false,
    liveAbove: ZERO,
    liveBelow: ZERO,
    liveDeposits: true,
    liveMaxMultipleBps: 20_000,
    liveCapExp: 2,
    liveCutoffSecs: 120,
    ...over,
  };
}

function position(side: "above" | "below", amount: bigint, live: LiveTotals): PositionView {
  return {
    address: PublicKey.default,
    key: "p",
    owner: PublicKey.default,
    market: PublicKey.default,
    marketKey: "m",
    side,
    amount,
    live,
    claimed: false,
  };
}

let failed = 0;
function check(name: string, got: bigint | number | null, want: bigint | number) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: got ${String(got)} want ${String(want)}`);
}

// The cap curve, half a window left.
const m0 = market({});
check("M k=2 half window", liveMultipleBps(m0, 1_800), 12_425);
check("M k=3 half window", liveMultipleBps(market({ liveCapExp: 3 }), 1_800), 11_162);
check("M k=2 121s left", liveMultipleBps(m0, 3_600 - 121), 9_911);
check("M at settle", liveMultipleBps(m0, 3_600), 9_900);

// A. The snipe: balanced 5,000/5,000, 10,000 on YES with 121s left.
const a = market({ abovePool: 5_000n * USDC, belowPool: 5_000n * USDC });
check("A snipe projected payout", projectedPayout(a, "above", 10_000n * USDC, 3_600 - 121), 9_911n * USDC);

// B. Mid window, same pools.
check("B mid-window projected payout", projectedPayout(a, "above", 10_000n * USDC, 1_800), 12_425n * USDC);

// C. Empty side filled late: YES 5,000 pre-lock, 100 on NO with 121s left.
const c = market({ abovePool: 5_000n * USDC });
check("C empty side takes the pot", projectedPayout(c, "below", 100n * USDC, 3_600 - 121), 5_049n * USDC);

// D. Two live deposits on the empty side, then the claims the program paid.
const d0 = market({ abovePool: 5_000n * USDC, liveCutoffSecs: 60 });
const bob = liveTerms(100n * USDC, 100, liveMultipleBps(d0, 3_600 - 360));
const afterBob = market({ ...d0, belowPool: 100n * USDC, liveBelow: bob });
check("D carol projected with bob in", projectedPayout(afterBob, "below", 100n * USDC, 3_600 - 72), 99n * USDC + 188_571_428n);

const carol = liveTerms(100n * USDC, 100, liveMultipleBps(d0, 3_600 - 72));
const settled = market({
  ...d0,
  state: "settled",
  winningSide: "below",
  belowPool: 200n * USDC,
  liveBelow: add(bob, carol),
});
check("D bob claim", claimValue(settled, position("below", 100n * USDC, bob)), 99n * USDC + 4_761_428_571n);
check("D carol claim", claimValue(settled, position("below", 100n * USDC, carol)), 99n * USDC + 188_571_428n);

// E. Pre-lock winner beside a capped sniper: alice keeps 9,889.
const e = market({
  state: "settled",
  winningSide: "above",
  abovePool: 15_000n * USDC,
  belowPool: 5_000n * USDC,
  liveAbove: liveTerms(10_000n * USDC, 100, 9_911),
});
check("E alice pre-lock claim", claimValue(e, position("above", 5_000n * USDC, ZERO)), 9_889n * USDC);
check("E sniper claim", claimValue(e, position("above", 10_000n * USDC, liveTerms(10_000n * USDC, 100, 9_911))), 9_911n * USDC);

// F. No live money at all: the old formula, 396 on a 400 pot.
const f = market({ state: "settled", winningSide: "above", abovePool: 100n * USDC, belowPool: 300n * USDC });
check("F old formula untouched", claimValue(f, position("above", 100n * USDC, ZERO)), 396n * USDC);

console.log(failed ? `\n${failed} FAILED` : "\nall match payout.rs");
process.exit(failed ? 1 : 0);
