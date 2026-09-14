# MoveX Equities

Volatility markets on US equities, settled on Solana.

For each listed stock, every trading day, the protocol publishes three thresholds. Each threshold is a market that asks one question: will the stock move more than this, in either direction? You pick a threshold, pick a side, and the day plays out.

**Program (devnet):** `9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL`

---

## Contents

1. [Overview](#1-overview)
2. [The Ladder](#2-the-ladder)
3. [How a Market Resolves](#3-how-a-market-resolves)
4. [Threshold Derivation](#4-threshold-derivation)
5. [Instruments](#5-instruments)
6. [Price Feed](#6-price-feed)
7. [Architecture](#7-architecture)
8. [Program Reference](#8-program-reference)
9. [Keeper](#9-keeper)
10. [Deployment](#10-deployment)
11. [Development](#11-development)
12. [Limitations](#12-limitations)
13. [Repository Layout](#13-repository-layout)

---

## 1. Overview

### The problem

Tokenized equities on Solana offer one kind of exposure: long or short. Someone who expects a stock to move sharply but has no view on direction has no instrument to express it. In traditional markets that view is expressed through options, which require an understanding of strikes, expiries, implied volatility, and greeks.

### The product

MoveX Equities asks a simpler question. For NVDA on a given day:

```
Will NVDA move more than 0.89%?      TIGHT
Will NVDA move more than 1.55%?      FAIR
Will NVDA move more than 2.35%?      WIDE
```

Each line is its own market. Direction is never measured: a 2% drop and a 2% rise are the same outcome. You choose a threshold, deposit on YES or NO, and collect if you were right.

### What you are protected from

| | |
|---|---|
| Maximum loss | Your deposit. There is no margin and no leverage. |
| Liquidation | None. There is no position to be liquidated. |
| Wrong direction | Not possible. Direction is not part of the outcome. |
| Changing your mind | Deposits can be withdrawn until the market locks. |

---

## 2. The Ladder

### Three thresholds per ticker

The three thresholds are not chosen by anyone. Each is a percentile of the stock's own recent behaviour, so each carries a known historical frequency.

| Tier | Percentile | Historical frequency of exceeding it | The question it asks |
|---|---|---|---|
| TIGHT | 25th | 75% of recent days | Does it move at all today? |
| FAIR | 50th | 50% of recent days | Coin flip. |
| WIDE | 75th | 25% of recent days | Is today a big one? |

The thresholds update every day as the window of recent sessions rolls forward. A calm month narrows them; a violent one widens them. No parameter is tuned by hand.

### Four outcome windows

Three thresholds divide the day into four equally likely outcomes:

```
NVDA, today

   under 0.89%     0.89% to 1.55%     1.55% to 2.35%     over 2.35%
   ┌───────────┬─────────────────┬─────────────────┬───────────┐
   │    25%    │       25%       │       25%       │    25%    │
   └───────────┴─────────────────┴─────────────────┴───────────┘
       flat           quiet            active           wild
```

The percentages are what history says. What the crowd is currently paying for each side is what the pools say. The difference between the two is the trade.

### Combining markets

Because the three thresholds are independent markets rather than sealed buckets, positions can be combined. A view of "normal day, neither dead nor wild" is expressed by taking YES on TIGHT and NO on WIDE. If the day comes in at 2.4% instead of 2.3%, one leg wins and the other loses rather than the whole position being wiped out over a tenth of a percent.

### Listed tickers

All listed tickers carry the full ladder.

| Ticker | Daily markets |
|---|---|
| NVDA | TIGHT, FAIR, WIDE |
| TSLA | TIGHT, FAIR, WIDE |
| SPY | TIGHT, FAIR, WIDE |

---

## 3. How a Market Resolves

### Two sides, one pot

Within a single market there is no order book and no counterparty to find. There are two pools. Deposits on YES go into the ABOVE pool, deposits on NO into the BELOW pool. The opposing pool is your counterparty.

```
NVDA / FAIR / 1.55%

  ABOVE   the stock moves MORE than 1.55%
  BELOW   the stock moves 1.55% or LESS
```

### The odds come from the crowd

Payouts are not set by the protocol. They are a function of where the money sits.

```
ABOVE pool   70,000        If ABOVE wins:  100,000 / 70,000 = 1.43x
BELOW pool   30,000        If BELOW wins:  100,000 / 30,000 = 3.33x
             ───────
Pot         100,000
```

Backing the less popular side pays more.

### Worked example

Alice deposits 1,000 USDX on BELOW in the NVDA FAIR market. NVDA closes at 218.29 and the next session closes at 220.15.

```
Move            |220.15 - 218.29| / 218.29 = 0.85%
Outcome         0.85% is under 1.55%, BELOW wins

Alice's share   1,000 / 30,000 = 3.33% of the BELOW pool
Distributable   100,000 less a 1% protocol fee = 99,000
Alice collects  3.33% of 99,000 = 3,300
Profit          2,300
```

Had NVDA closed at 213.90 instead, the move would have been 2.01%, ABOVE would have won, and Alice would have lost her 1,000. Those are the only two outcomes available to her position.

### Lifecycle

| State | What is possible | How it transitions |
|---|---|---|
| Open | Deposit and withdraw, until the lock timestamp | Created by the keeper |
| Locked | Nothing. The reference price has been recorded. | `lock`, at or after the lock timestamp |
| Settled | Winners claim their share | `settle`, at or after the settle timestamp |
| Voided | Everyone claims a full refund, no fee | One pool empty at lock, or no resolution within 6 hours of settle time |

Deposits close on the timestamp itself, enforced by the program. `lock` and `settle` can be submitted by anyone.

### Settlement arithmetic

```
move_bps      = |settlement_price - reference_price| * 10_000 / reference_price
above_wins    = move_bps > strike_bps                (a tie resolves to BELOW)

pot           = above_pool + below_pool
distributable = pot - pot * fee_bps / 10_000
payout(user)  = user.amount * distributable / winning_pool
```

Intermediate arithmetic is u128. Division truncates, so the sum of all payouts never exceeds the distributable amount.

---

## 4. Threshold Derivation

### Method

1. Take the 20 most recent completed windows for the ticker.
2. Measure the absolute move in each.
3. Sort the 20 values.
4. Read off the 25th, 50th and 75th percentiles.

### Example

NVDA, daily close-to-close, 20 sessions ending 2026-09-11, in basis points:

```
3  6  7  33  84  91  98  99  148  151  159  180  201  219  234  237  291  321  457  874

25th = 89 (0.89%)      50th = 155 (1.55%)      75th = 235 (2.35%)
```

The 874 at the right edge, a single violent session, does not move the median. A mean or a standard deviation would have been pulled toward it. Percentiles are used for exactly this reason: equity returns have fat tails, and a sigma-based ladder systematically misprices them.

### Verified on chain

The keeper computes the thresholds off chain, but the program does not take its word for it. `init_market` receives the threshold together with the 20 samples it came from, recomputes the percentile, and rejects the market if the two disagree.

```
P25 = (s[4]  * 25 + s[5]  * 75) / 100
P50 = (s[9]  * 50 + s[10] * 50) / 100
P75 = (s[14] * 75 + s[15] * 25) / 100
```

With 20 samples the interpolation index lands on an exact quarter for every tier, so the computation is integer-only and the keeper reproduces it bit for bit. The 20 samples are stored in the market account and are publicly auditable.

A keeper therefore cannot publish a sample series and a threshold the series does not produce. What remains off chain is only the sourcing of the samples themselves.

---

## 5. Instruments

Two instruments share the program. They differ in the window they measure and the data they are calibrated on.

### Daily

The product. Measures from one session's close to the next session's close.

| | |
|---|---|
| Reference price | Official close of the prior session |
| Settlement price | Official close of the current session |
| Deposit window | 24 hours, ending at the reference close |
| Calibration | Trailing 20 daily close-to-close moves |
| Markets per ticker per day | 3 (TIGHT, FAIR, WIDE) |

Close to close is used rather than open to close so that the overnight gap is inside the measurement. NVDA's own bars show why:

```
Overnight, 15:30 to next 09:30      2.445%,  1.474%
Any single regular-session hour      0.04% to 0.64%
```

Most of a day's move happens with the market closed. An open-to-close market would record a flat session on a day the stock gapped 8% on earnings, and pay out BELOW on the most volatile day of the quarter.

### Hourly

An intraday instrument, so the full lifecycle can be observed in minutes rather than two days. Presented separately from the daily product.

| | |
|---|---|
| Window | One hour, on the clock, 10:00 to 16:00 ET |
| Markets per session | 6, or 3 on a 13:00 early close |
| Deposit window | From 09:00 ET until the market's lock time |
| Calibration | Trailing 20 regular-session hourly moves |
| Ticker | NVDA, FAIR |

Hourly markets carry their own thresholds. Reusing the daily 1.55% would resolve BELOW almost every hour and leave one pool empty.

| | TIGHT | FAIR | WIDE |
|---|---|---|---|
| Daily | 0.89% | 1.55% | 2.35% |
| Hourly | 0.09% | 0.15% | 0.33% |

The hourly ladder excludes extended-hours bars and any pair of bars not exactly one hour apart, which removes overnight gaps and the partial bar at the close.

---

## 6. Price Feed

### Production

The production build reads Pyth `PriceUpdateV2` accounts. Prices are normalized to a fixed exponent. Reads are rejected when the publish time is older than 120 seconds or the confidence interval exceeds 1% of price.

### Devnet

Pyth's Hermes API has required a paid key since August 2026, and the sponsored equity feed accounts on devnet are no longer updated. At the time of writing they were 73 days stale. The devnet build therefore reads a `PriceFeed` account written by this project's keeper.

The account mirrors the shape of a Pyth sponsored feed: one fixed address per ticker, continuously updated, read by the program and the frontend alike. The two sources sit behind the same interface and are selected at compile time. The production build contains no instruction capable of writing a price.

```
PriceFeed
  publisher      Pubkey     only key permitted to write
  price          u64        scaled by 10^-8
  conf           u64        cross-source spread, same scale
  publish_time   i64        when the source produced it, not when it was written
  source_count   u8
```

Write constraints:

- Signer must equal `publisher`.
- `publish_time` must be strictly greater than the stored value.
- `conf` must not exceed `price / 100`.

The confidence check is applied again on read.

### Trust model

On devnet, settlement prices are asserted by a single publisher operated by this project. The program enforces publisher identity, monotonic time, and a disagreement bound. It does not, and cannot, verify that a published price corresponds to the market. This is stated again in section 12.

Threshold verification (section 4) is independent of the price source.

### Settlement price selection

The keeper submits `update_price` and `lock` (or `settle`) in a single transaction, so the price consumed is the price just fetched. Daily markets settle on the official closing print. Hourly markets settle on the last trade.

---

## 7. Architecture

```
+--------------------------------------------------------------+
| keeper/            AWS Lambda, EventBridge Scheduler          |
|                                                              |
|   Publisher        */1 min     update_price x 3 tickers      |
|   HourlyMarkets    09:00 ET    init_market x 6               |
|   DailyMarkets     15:55 ET    init_market x 9               |
|   Crank            */1 min     lock / settle                 |
|   Seeder           */10 min    fund both sides, claim wins   |
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
                            | direct account reads, wallet-signed writes
                            v
+--------------------------------------------------------------+
| frontend/          Next.js 16, wallet adapter, Anchor client |
|                                                              |
|   /                the board: prices, ladders, sessions      |
|   /market/[addr]   price against threshold, pools, deposit   |
|   /portfolio       balances, faucet, positions, claims       |
+--------------------------------------------------------------+
```

The frontend reads program accounts directly and signs deposits, withdrawals and claims with the user's wallet. There is no indexing layer and no server of ours between the browser and the chain. Every address is derivable from ticker, session identifier, and tier.

All schedules are declared in `America/New_York`. Market holidays and early closes are handled by a calendar module that refuses to answer for years it does not cover rather than assuming a weekday is a session.

---

## 8. Program Reference

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

One `Position` per user per market. The side can change only while the balance is zero.

### Instructions

| Instruction | Signer | Available when |
|---|---|---|
| `init_market` | authority | Always |
| `deposit` | user | `state == Open && now < lock_ts` |
| `withdraw` | user | `state == Open && now < lock_ts` |
| `lock` | anyone | `state == Open && now >= lock_ts` |
| `settle` | anyone | `state == Locked && now >= settle_ts` |
| `claim` | user | `state in (Settled, Voided)`, once per position |
| `void_market` | anyone | `state in (Open, Locked) && now > settle_ts + 6h` |
| `collect_fee` | anyone | `state == Settled`, once per market |
| `init_faucet`, `faucet_mint` | | Feature `devnet-faucet` |
| `init_price_feed`, `update_price` | publisher | Feature `keeper-oracle` |

### Edge cases

| Condition | Result |
|---|---|
| One pool empty at `lock` | Market voided. Full refunds. |
| `move_bps == strike_bps` | BELOW wins. |
| Oracle stale or unreadable at `lock` or `settle` | Instruction fails and can be retried. Market state unchanged. |
| Unresolved 6 hours past `settle_ts` | `void_market` available to anyone. Full refunds, no fee. |
| `claim` on a voided market | Original deposit returned. |
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

## 9. Keeper

Five Lambda functions deployed with AWS CDK. Each is idempotent: it derives the set of accounts that should exist or be acted on, reads their current state, and performs only what is outstanding. A missed invocation is corrected by the next one.

| Function | Schedule | Responsibility |
|---|---|---|
| Publisher | Every minute, weekdays | Fetch quotes, write `PriceFeed` for each ticker |
| HourlyMarkets | 09:00 ET, weekdays | Create the session's hourly markets |
| DailyMarkets | 15:55 ET, weekdays | Create the daily markets that lock at the next session's close |
| Crank | Every minute, weekdays | `lock` and `settle` due markets, bundling `update_price` |
| Seeder | Every 10 minutes, weekdays | Devnet only. Funds both sides of open markets from three derived wallets and claims their winnings |

The signing key is read from SSM Parameter Store at cold start and cached for the container lifetime. IAM grants `ssm:GetParameter` on that single parameter ARN and nothing else.

Quote source is the Yahoo Finance chart API. Daily calibration uses daily bars; hourly calibration uses hourly bars filtered to regular session hours. Daily settlement uses the official close from the daily bar; hourly settlement uses the current price.

The crank does not act more than 20 minutes after a market's scheduled time. Past that, the market is left to void.

---

## 10. Deployment

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

USDX is a valueless SPL token. Mint authority is held by the faucet PDA, so `faucet_mint` is the only path to supply. Allowance is 10,000 USDX per address per 24 hours.

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

## 11. Development

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

Tests run on litesvm in process. The full suite completes in under one second.

### Keeper

```bash
cd keeper
npm install
npm test
npm run typecheck
npm run strikes                  # print the current ladders and the series behind them
npx tsx scripts/preflight.ts     # exercise the lambda code paths without deploying

# Create today's markets ahead of the schedule, signing with the Solana CLI
# keypair. The lambdas find them already there and skip them.
RPC_URL=... npx tsx scripts/create-session.ts --dry-run
RPC_URL=... npx tsx scripts/create-session.ts

# Run a lambda locally with the CLI keypair instead of the parameter store.
KEYPAIR_PATH=~/.config/solana/devnet.json RPC_URL=... QUOTE_MINT=... \
  npx tsx -e 'import("./lib/lambdas/keeper/seeder.ts").then((m) => m.handler())'
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local       # optional: a Helius devnet RPC URL
npm run dev                      # http://localhost:3000
npx tsc --noEmit
```

The app needs no configuration to run against the live devnet deployment. A wallet on devnet, a little SOL for fees, and USDX from the in-app faucet are all a user needs. See `frontend/README.md` for the page map and the on-chain reads behind each screen.

### Test coverage

| Suite | Tests | Scope |
|---|---|---|
| Program, unit | 23 | Percentile verification, payout arithmetic, move calculation |
| Program, deposit path | 10 | Market creation, deposit, withdraw, rejection cases |
| Program, lifecycle | 14 | Lock, settle, claim, void, fee collection, tie resolution |
| Program, faucet | 6 | Cooldown, per-user isolation, mint authority |
| Keeper | 93 | Ladders, calendar, window validation, seeding rules, stack configuration |

---

## 12. Limitations

**Devnet settlement prices are published by a single party.** The production build reads Pyth; the devnet build reads a feed written by this project's keeper. On devnet the program cannot verify that a published price corresponds to the market. See section 6.

**Sample provenance is not verified on chain.** The program verifies that a threshold is the correct percentile of its samples. It does not verify that the samples are genuine market data.

**Hourly markets measure intraday movement.** They are calibrated separately and presented as a distinct instrument. The daily product measures close to close for the reasons given in section 5.

**Single price source.** The `PriceFeed` account and program checks support multiple sources; the keeper currently publishes from one.

**Devnet only.** No mainnet deployment. No real funds.

---

## 13. Repository Layout

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
      keeper/          publisher, market creation, crank, seeder
      shared/          calendar, quotes, ladders, Solana client
      strikes/         calibration pipeline
  test/

frontend/
  src/
    app/               routes, layout, providers
    components/
      trading/         the board and the move gauge
      market/          market page and deposit panel
      portfolio/       wallet, faucet, positions, share card
      ui/              primitives, navbar, wallet button
    hooks/             react-query wrappers over program accounts
    lib/               config, IDL, PDAs, market model, calendar
```
