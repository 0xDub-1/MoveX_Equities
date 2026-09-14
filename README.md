# MoveX Equities

Parimutuel volatility markets on US equities, settled on Solana.

Each market resolves a single question: whether a stock's absolute price move over a fixed window exceeds a threshold. Direction is not measured. Participants deposit into one of two pools; the pool on the correct side of the threshold splits the pot pro rata.

**Program (devnet):** `9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL`

---

## Contents

1. [Overview](#1-overview)
2. [Market Mechanics](#2-market-mechanics)
3. [Threshold Derivation](#3-threshold-derivation)
4. [Instruments](#4-instruments)
5. [Price Feed](#5-price-feed)
6. [Architecture](#6-architecture)
7. [Program Reference](#7-program-reference)
8. [Keeper](#8-keeper)
9. [Deployment](#9-deployment)
10. [Development](#10-development)
11. [Limitations](#11-limitations)
12. [Repository Layout](#12-repository-layout)

---

## 1. Overview

### Motivation

Tokenized equities on Solana expose a single dimension of exposure: long or short. A participant who expects a large move without a directional view has no instrument. In traditional markets that view is expressed through options, which require familiarity with strikes, expiries, implied volatility, and greeks.

MoveX Equities reduces the volatility trade to one binary question per market:

> Did the stock move more than X% over the window, in either direction?

### Properties

| Property | Guarantee |
|---|---|
| Maximum loss | The deposited stake. No margin, no leverage. |
| Liquidation | None. There is no position to margin-call. |
| Directional risk | None. Payout is a function of absolute move only. |
| Exit before lock | Deposits are withdrawable until the lock timestamp. |
| Counterparty | The opposing pool. No order matching. |

---

## 2. Market Mechanics

### Structure

A market consists of two pools, ABOVE and BELOW, a threshold in basis points, and two timestamps.

```
Market: NVDA / 2026-09-16 / FAIR / 155 bps

  ABOVE   |move| > 1.55%
  BELOW   |move| <= 1.55%
```

Payout odds are implied by pool sizes and are not set by the protocol.

```
above_pool = 70,000    payout if ABOVE wins = 100,000 / 70,000 = 1.43x
below_pool = 30,000    payout if BELOW wins = 100,000 / 30,000 = 3.33x
```

### Lifecycle

| State | Transition | Trigger |
|---|---|---|
| Open | Accepts `deposit` and `withdraw` while `now < lock_ts` | `init_market` |
| Locked | Reference price recorded | `lock`, at or after `lock_ts` |
| Settled | Settlement price recorded, winning side determined | `settle`, at or after `settle_ts` |
| Voided | All deposits refundable in full, no fee | Empty pool at lock, or `void_market` after grace period |

The deposit window closes on `lock_ts` by program check. No external action is required. The `lock` and `settle` instructions are permissionless.

### Settlement

```
move_bps      = |settlement_price - reference_price| * 10_000 / reference_price
above_wins    = move_bps > strike_bps                  (tie resolves to BELOW)

pot           = above_pool + below_pool
fee           = pot * fee_bps / 10_000
distributable = pot - fee
payout(user)  = user.amount * distributable / winning_pool
```

Intermediate arithmetic is u128. Division truncates; the sum of payouts never exceeds `distributable`.

---

## 3. Threshold Derivation

### Method

The threshold is an empirical percentile of the underlying's trailing absolute moves. No model, no forecast, no manual parameter.

1. Take the 20 most recent completed windows.
2. Compute the absolute move in each.
3. Sort ascending.
4. Read the percentile for the tier.

| Tier | Percentile | Historical frequency of ABOVE |
|---|---|---|
| TIGHT | P25 | 75% |
| FAIR | P50 | 50% |
| WIDE | P75 | 25% |

Each tier's base rate holds by construction. Percentiles are used rather than standard deviations because equity returns are not normally distributed and a sigma-based ladder systematically underweights the tail.

### Example

NVDA, daily close-to-close, 20 sessions ending 2026-09-11, basis points:

```
3  6  7  33  84  91  98  99  148  151  159  180  201  219  234  237  291  321  457  874

P25 = 89    P50 = 155    P75 = 235
```

### On-chain verification

`init_market` accepts both the threshold and the 20 samples it was derived from. The program recomputes the percentile and rejects the instruction if the values disagree.

```
P25 = (s[4]  * 25 + s[5]  * 75) / 100
P50 = (s[9]  * 50 + s[10] * 50) / 100
P75 = (s[14] * 75 + s[15] * 25) / 100
```

For n = 20 the interpolation index falls on an exact quarter for each tier, so the computation is integer-only and reproducible. The samples are stored in the `Market` account (40 bytes) and are publicly auditable.

Consequence: a keeper cannot publish a sample series and a threshold that the series does not produce. What remains off-chain is the sourcing of the samples themselves.

---

## 4. Instruments

Two instruments share the program and differ in window and calibration.

### Daily

| | |
|---|---|
| Window | Previous session close to current session close |
| Reference | Official closing price, prior session |
| Settlement | Official closing price, current session |
| Deposit window | 24 hours, ending at the reference close |
| Calibration | Trailing 20 daily close-to-close moves |
| Tickers | NVDA (TIGHT, FAIR, WIDE), TSLA (FAIR), SPY (FAIR) |

Close-to-close is used rather than open-to-close so that overnight gaps are included in the measurement. Observed NVDA data supports the choice:

```
Overnight, 15:30 to next 09:30      2.445%,  1.474%
Any single regular-session hour      0.04% to 0.64%
```

An open-to-close market would record a flat session on a day the stock gapped materially at the open.

### Hourly

| | |
|---|---|
| Window | One hour, aligned to the clock, 10:00 to 16:00 ET |
| Markets per session | 6 (3 on a 13:00 early close) |
| Deposit window | From 09:00 ET until the market's lock time |
| Calibration | Trailing 20 regular-session hourly moves |
| Tickers | NVDA (FAIR) |

Hourly markets are calibrated on hourly bars. The daily threshold is not reused: at 155 bps it would resolve BELOW in nearly every hour, leaving one pool empty.

| | TIGHT | FAIR | WIDE |
|---|---|---|---|
| Daily | 0.89% | 1.55% | 2.35% |
| Hourly | 0.09% | 0.15% | 0.33% |

Hourly calibration excludes extended-hours bars and any bar pair not exactly 3600 seconds apart, which removes overnight gaps and the partial bar at the close.

Hourly markets are an intraday instrument and are presented separately from the daily product.

---

## 5. Price Feed

### Production

The production build reads Pyth `PriceUpdateV2` accounts. Prices are normalized to a fixed exponent before use. Reads are rejected when the publish time exceeds `MAX_PRICE_AGE_SECS` (120) or the confidence interval exceeds 1% of price.

### Devnet

Pyth's Hermes API has required a paid key since August 2026. The sponsored equity feed accounts on devnet are no longer updated; at the time of writing they were 73 days stale. The devnet build therefore reads a `PriceFeed` account written by this project's keeper.

The account mirrors the shape of a Pyth sponsored feed: one fixed address per underlying, continuously updated, read by both the program and the frontend. Selection between the two sources is a compile-time feature (`keeper-oracle`). The production build contains no instruction capable of writing a price.

```
PriceFeed
  publisher      Pubkey     only key permitted to write
  price          u64        scaled by 10^-8
  conf           u64        cross-source spread, same scale
  publish_time   i64        source timestamp, not write time
  source_count   u8
```

Write constraints:

- Signer must equal `publisher`.
- `publish_time` must be strictly greater than the stored value.
- `conf` must not exceed `price / 100`.

The confidence check is applied again on read.

### Trust model

On devnet, settlement prices are asserted by a single publisher operated by this project. The program enforces publisher identity, monotonic time, and a disagreement bound, but does not and cannot verify that the published price corresponds to the market. This is a known limitation and is stated in section 11.

The threshold verification in section 3 is independent of the price source.

### Settlement price selection

The keeper submits `update_price` and `lock` (or `settle`) in a single transaction, so the price consumed is the price just fetched. Daily markets settle on the official closing print; hourly markets settle on the last trade.

---

## 6. Architecture

```
+--------------------------------------------------------------+
| keeper/            AWS Lambda, EventBridge Scheduler          |
|                                                              |
|   Publisher        */1 min     update_price x 3 tickers      |
|   HourlyMarkets    09:00 ET    init_market x 6               |
|   DailyMarkets     15:55 ET    init_market x 5               |
|   Crank            */1 min     lock / settle                 |
+---------------------------+----------------------------------+
                            | signs with key from SSM Parameter Store
                            v
+--------------------------------------------------------------+
| program/           Anchor 1.2, Solana devnet                 |
|                                                              |
|   Market           ["market", ticker, session, tier]         |
|   Position         ["position", market, user]                |
|   Vault            ["vault", market]                         |
|   PriceFeed        ["price_feed", ticker]                    |
|   Faucet           ["faucet", mint]                          |
+---------------------------+----------------------------------+
                            | direct account reads
                            v
                         frontend
```

The frontend reads program accounts directly. There is no indexing layer. All addresses are derivable from ticker, session identifier, and tier.

All schedules are declared in `America/New_York`. Market holidays and early closes are handled by a calendar module that refuses to answer for uncovered years rather than defaulting to a trading day.

---

## 7. Program Reference

### Accounts

```
Market
  authority          Pubkey
  underlying         [u8; 8]       ASCII ticker, space-padded
  session_date       [u8; 10]      session identifier
  tier               Tier          Tight | Fair | Wide
  pyth_feed          Pubkey        price account bound at creation
  quote_mint         Pubkey
  vault              Pubkey
  strike_bps         u16
  samples_bps        [u16; 20]     sorted ascending
  state              MarketState   Open | Locked | Settled | Voided
  reference_price    u64
  settlement_price   u64
  above_pool         u64
  below_pool         u64
  winning_side       Option<Side>
  fee_bps            u16
  treasury           Pubkey
  fee_collected      bool
  lock_ts            i64
  settle_ts          i64

Position
  owner              Pubkey
  market             Pubkey
  side               Side          Above | Below
  amount             u64
  claimed            bool
```

One `Position` per user per market. The side may change only when the balance is zero.

### Instructions

| Instruction | Signer | Availability |
|---|---|---|
| `init_market` | authority | Always |
| `deposit` | user | `state == Open && now < lock_ts` |
| `withdraw` | user | `state == Open && now < lock_ts` |
| `lock` | any | `state == Open && now >= lock_ts` |
| `settle` | any | `state == Locked && now >= settle_ts` |
| `claim` | user | `state in (Settled, Voided)`, once per position |
| `void_market` | any | `state in (Open, Locked) && now > settle_ts + 6h` |
| `collect_fee` | any | `state == Settled`, once per market |
| `init_faucet`, `faucet_mint` | | Feature `devnet-faucet` |
| `init_price_feed`, `update_price` | publisher | Feature `keeper-oracle` |

### Edge case behaviour

| Condition | Result |
|---|---|
| One pool empty at `lock` | Market voided. Full refunds. |
| `move_bps == strike_bps` | BELOW wins. |
| Oracle stale or unreadable at `lock` or `settle` | Instruction fails. Retryable. Market state unchanged. |
| Market unresolved 6 hours past `settle_ts` | `void_market` available to anyone. Full refunds, no fee. |
| `claim` on voided market | Original deposit returned. |
| Duplicate `claim` | Rejected. |

### Constants

| Constant | Value |
|---|---|
| `LOOKBACK_SESSIONS` | 20 |
| `MAX_FEE_BPS` | 500 |
| `MIN_DEPOSIT` | 1.000000 (6 decimals) |
| `MAX_PRICE_AGE_SECS` | 120 |
| `MAX_CONFIDENCE_RATIO` | 100 (1% of price) |
| `VOID_GRACE_SECS` | 21,600 |
| `KEEPER_PRICE_EXPONENT` | -8 |

---

## 8. Keeper

Four Lambda functions deployed with AWS CDK. Each is idempotent: it derives the set of accounts that should exist or be acted upon, reads their current state, and performs only the outstanding operations. A missed invocation is corrected by the next.

| Function | Schedule | Responsibility |
|---|---|---|
| Publisher | Every minute, weekdays | Fetch quotes, write `PriceFeed` for each ticker |
| HourlyMarkets | 09:00 ET, weekdays | Create the session's hourly markets |
| DailyMarkets | 15:55 ET, weekdays | Create markets locking at the current close |
| Crank | Every minute, weekdays | `lock` and `settle` due markets, bundling `update_price` |

The signing key is read from SSM Parameter Store at cold start and cached for the container lifetime. IAM grants `ssm:GetParameter` on that single parameter ARN and nothing else.

Quote source: Yahoo Finance chart API. Daily calibration uses `interval=1d`; hourly calibration uses `interval=1h` filtered to regular session hours. Settlement of daily markets uses the official close from the daily bar; hourly settlement uses the current price.

The crank will not act more than 20 minutes after a market's scheduled time. Beyond that window the market is left to void.

---

## 9. Deployment

### Devnet addresses

```
Program          9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL
Quote mint       FBnaipfxQK8M3ZMMM3bwnzgbgKDLPGJ2rJdUANHocBve   (USDX, 6 decimals)
Faucet           AR5q8xnQUeP9a9UcdjvXWAdaGxr8aFUBJuM1fPT8zfL9

PriceFeed NVDA   AGHVsmmpSPawAVjdt6Kz8wTHYgjdhWsEtbAJ4Z1EqT8c
PriceFeed TSLA   7MTEtbktfdVUNcXfkh1GqnHXz6WPd4iMRHHVFzmgSpsM
PriceFeed SPY    RNTbijEkEUfyYtaBuKHqxRve11RFsSzETw3du6Yz6tQ
```

### Test token

USDX is a valueless SPL token. Mint authority is held by the faucet PDA; `faucet_mint` is the only path to supply. Allowance is 10,000 USDX per address per 24 hours.

### Keeper prerequisites

Two SSM parameters, type String:

```
/movex_equities/main_keypair    publisher secret key (base58 or JSON byte array)
/movex_equities/rpc_url         Solana RPC endpoint
```

Then:

```bash
cd keeper && npx cdk deploy
```

---

## 10. Development

### Program

```bash
cd program

# Production build: Pyth oracle, no faucet
anchor build --arch v0
cargo test

# Devnet build: keeper oracle and faucet
anchor build --arch v0 -- --features keeper-oracle,devnet-faucet
cargo test --features keeper-oracle,devnet-faucet
```

`--arch v0` is required. Anchor 1.2 defaults to SBPF v3, which litesvm 0.10 does not load.

Tests execute on litesvm in-process. The full suite runs in under one second.

### Keeper

```bash
cd keeper
npm install
npm test
npm run typecheck
npm run strikes                  # print current ladders and sample series
npx tsx scripts/preflight.ts     # exercise lambda code paths without deploying
```

### Test coverage

| Suite | Tests | Scope |
|---|---|---|
| Program, unit | 23 | Percentile verification, payout arithmetic, move calculation |
| Program, deposit path | 10 | Market creation, deposit, withdraw, rejection cases |
| Program, lifecycle | 14 | Lock, settle, claim, void, fee collection, tie resolution |
| Program, faucet | 6 | Cooldown, per-user isolation, mint authority |
| Keeper | 70 | Ladders, calendar, window validation, stack configuration |

---

## 11. Limitations

**Devnet settlement prices are published by a single party.** The production build reads Pyth; the devnet build reads a feed written by this project's keeper. On devnet the program cannot verify that a published price corresponds to the market. See section 5.

**Sample provenance is not verified on chain.** The program verifies that a threshold is the correct percentile of its samples. It does not verify that the samples are genuine market data.

**Hourly markets measure intraday movement.** They are calibrated separately and presented as a distinct instrument. The daily product measures close to close for the reasons given in section 4.

**Single price source.** The `PriceFeed` account and program checks support multiple sources; the keeper currently publishes from one.

**Devnet only.** No mainnet deployment. No real funds.

---

## 12. Repository Layout

```
docs/
  PROJECT.en.md       product and protocol specification
  PROJECT.es.md       Spanish translation
  OVERVIEW.md         product summary
  ROADMAP.md          execution plan, decisions, cut lines

program/
  programs/movex-equities/
    src/
      constants.rs
      state.rs
      strike.rs        percentile verification
      oracle.rs        price reads, both sources
      payout.rs        settlement arithmetic
      instructions/
    tests/             litesvm integration tests
  scripts/             devnet setup and diagnostics

keeper/
  lib/
    keeper-stack.ts    CDK stack
    lambdas/
      keeper/          publisher, market creation, crank
      shared/          calendar, quotes, ladders, Solana client
      strikes/         Phase 0 calibration pipeline
  test/
```
