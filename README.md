# MoveX Equities

**Trade how much a stock moves. Not which way.**

Daily volatility markets on US stocks, on Solana. Built for Stocklana.

---

## The idea in one line

Every trading day, for every ticker we list, there is one market and one
question:

> **How much will this stock move today?**

You take a side. The session plays out. The side that was right splits the pot.

Direction is irrelevant. A stock that drops 4% and one that rips 4% pay out
identically. All that matters is distance travelled.

---

## The problem

Volatility is one of the most heavily traded things in traditional finance.
Buying a straddle before a catalyst is a standard trade millions of people
place every year. The view is simple and extremely common:

> *"Something big is about to happen to this stock. I'm confident it moves
> hard. I have no idea which direction."*

Onchain, there is no way to express that view.

Tokenized equities are arriving fast on Solana, and they give you exactly one
lever: up or down. If you don't have a directional opinion, your options are
to fake one you don't believe, or to sit the day out.

The traditional answer is options, which asks a normal person to learn
strikes, expiries, implied volatility and greeks before placing a single
trade. Most people never climb that wall.

MoveX Equities collapses all of it into one number anybody can reason about:

> *NVDA moved 2.0% today. Was that more or less than 1.55%?*

---

## How a market works

### Two pools, no order book

There is no matching engine and no counterparty to find. There are two pools,
and you pick one.

```
NVDA · session 2026-09-16 · threshold 1.55%

     ┌──────────────────────┐   ┌──────────────────────┐
     │        ABOVE         │   │        BELOW         │
     │  moves MORE than     │   │  moves LESS than     │
     │  1.55%, either way   │   │  1.55%               │
     └──────────────────────┘   └──────────────────────┘
```

The opposite pool **is** your counterparty, collectively.

### The odds come from the crowd

Nobody sets payouts. They fall out of where the money sits.

```
ABOVE   $70,000        If ABOVE wins:  100k / 70k = 1.43x
BELOW   $30,000        If BELOW wins:  100k / 30k = 3.33x
        ────────
POT     $100,000
```

Backing the unpopular side pays more. Standard parimutuel mechanics.

### The lifecycle

```
              deposits open                deposits close
                    │                            │
                    ▼                            ▼
  init_market ──────────── deposit / withdraw ───── lock ──── settle ──── claim
                                                     │          │
                                                     │          │
                                          reference price   settlement price
                                          recorded          recorded, a side wins
```

Deposits close **on the timestamp**, enforced by the program itself. Nobody
has to run anything for that to happen. `lock` and `settle` are separate
permissionless instructions that read the oracle and move the market forward.

### What cannot happen to you

- You cannot lose more than you put in. No margin, no borrowing.
- You cannot be liquidated. There is no position to margin call.
- You cannot be wrong about direction. The product has no direction.
- You cannot get stuck. Deposits are refundable right up until lock.

The worst outcome available is losing the stake you chose. That is the whole
risk surface, which also means no bad debt and no insurance fund.

---

## The threshold: computed, then verified on chain

This is the part that decides whether the product is serious or a coin flip
with a logo. If a human picks the threshold, everything downstream is
arbitrary.

So no human picks it, and the program does not take our word for it either.

### How it is derived

```
1. Take the last 20 completed sessions.
2. Measure how far the stock moved in each, ignoring direction.
3. Sort those 20 numbers.
4. Read off the quarter, half and three-quarter marks.
```

Real NVDA data, window ending 2026-09-11, in basis points:

```
3  6  7  33  84 │ 91  98  99  148  151 │ 159  180  201  219  234 │ 237  291  321  457  874
                ↑                      ↑                         ↑
            P25 = 0.89%           P50 = 1.55%               P75 = 2.35%
```

Each rung carries its base rate **by construction**: P50 means exactly half of
recent sessions moved more. It is arithmetic on a published series, not an
estimate. A user can verify it by counting.

Note the 8.74% at the right edge. The median does not flinch at it. A mean or
a standard deviation would have been dragged upward by that single session,
which is why the ladder is built on quantiles.

### The program checks the maths itself

`init_market` receives a strike **and** the 20 samples it came from. It
recomputes the percentile and **rejects the market unless they agree**.

```
P25 = (s[4]·25  + s[5]·75)  / 100
P50 = (s[9]·50  + s[10]·50) / 100
P75 = (s[14]·75 + s[15]·25) / 100
```

A percentile at `idx = p·(n-1)` over 20 samples always lands on a clean
quarter, so the weights are exact hundredths and the whole computation stays
in integers. No floating point enters the program, and the off-chain keeper
reproduces it bit for bit.

That is the difference between "trust our formula" and a constraint. **A
keeper cannot publish a series and quote a strike that series does not
produce**, by bug or by choice. The 20 samples live in the `Market` account,
40 bytes, so anyone can recompute it.

Tests cover a strike off by a single basis point and a correct P25 declared
as the Fair tier. Both are rejected.

### Why percentiles rather than standard deviations

The conventional approach sets strikes as multiples of sigma, which assumes
returns are normally distributed. Equity returns are not: they have fat tails,
so a sigma ladder understates exactly the violent days that matter most to a
volatility product. Reading empirical quantiles assumes nothing.

### Earnings need no special handling

A day where a company reports is simply a day where recent sessions were
violent, so the threshold widens on its own. No separate earnings product, no
manual intervention.

That is the difference between something that works four days a year per
ticker and something that works 252.

---

## Two instruments, two calibrations

### Daily: close to close

The product. Locks at one session's close, settles at the next.

```
close(D-1)  ──── overnight gap ──── full session D ──── close(D)
    │                                                      │
  reference                                            settlement
```

**Measuring close to close rather than within the session is deliberate, and
the data proves it matters.** From our own hourly bars for NVDA:

```
15:30 Wed → 09:30 Thu     2.445%     ← overnight
15:30 Thu → 09:30 Fri     1.474%     ← overnight

any single hour within a session    0.04% to 0.64%
```

The overnight gap is larger than the entire trading session that follows it.
A company reports after the bell, the stock gaps 8% at the open and drifts
flat, and an intraday market would record a 0.4% move and pay out BELOW on the
most volatile day of the quarter.

Close to close also matches what everyone already means by "how much did it
move today".

### Hourly: within the session

Intraday markets running hour to hour, so the full lifecycle is observable in
minutes instead of two days. Six per session, whole hours from 10:00 ET:

```
10:00→11:00   11:00→12:00   12:00→13:00   13:00→14:00   14:00→15:00   15:00→16:00
```

The 6.5 hour session does not divide into whole hours, so half an hour is
unused. We take it off the **open**, the noisiest stretch, so the last market
settles exactly at the close, the most liquid moment of the day.

**They carry their own ladder, calibrated on hourly bars.** This is not
optional. NVDA's hourly moves are genuinely small:

| | TIGHT | FAIR | WIDE |
|---|---|---|---|
| Daily (close to close) | 0.89% | 1.55% | 2.35% |
| Hourly (within session) | 0.09% | **0.15%** | 0.33% |

A one-hour market carrying the daily 1.55% strike would settle BELOW nearly
every time. Nobody would take ABOVE, and the market would void for want of a
counterparty. At 0.15% it is a genuine coin flip, because that number **is**
the median of NVDA's recent hours.

Worth noting the ratio: hourly FAIR is a tenth of daily FAIR, not the ~0.4
that scaling by the square root of time would predict. That gap is the same
finding as above, in another form: most of the daily move happens with the
market closed, so it is not available to be spread across the hours.

Hourly markets are labelled as intraday in the UI and are a different
instrument, not the product.

---

## The price feed: ours, and we say so

### Why we built one

Pyth is the natural oracle here, and the program's production build reads it.
But in **August 2026 Pyth moved its Hermes API behind a paid key**, with no
free tier and the entry plan at $500/month. As a consequence, the sponsored
equity feed accounts on devnet stopped being updated. When we checked them:

```
NVDA   198.37     73.4 days old
TSLA   413.35     73.4 days old
SPY    750.53     73.4 days old
```

Settling against those would have meant settling against a price from June.

### What we do instead

A `PriceFeed` account per ticker, written by our own keeper every minute
during market hours. Deliberately shaped like a Pyth sponsored feed: one fixed
address per underlying, updated continuously, read by the program and the
frontend alike.

That shape is the point. **The frontend reads prices from chain, not from a
side API that could disagree with settlement**, and swapping back to Pyth
changes one file.

```rust
// oracle.rs
#[cfg(feature = "keeper-oracle")]     fn read_price_inner(...)  // our feed
#[cfg(not(feature = "keeper-oracle"))] fn read_price_inner(...)  // Pyth
```

Both build shapes are kept green in CI. The production build **contains no
instruction that can write a price**, and that is verified rather than
asserted: `setMockPrice` and `updatePrice` are absent from its IDL.

### Being straight about what this costs

**What the devnet oracle lacks against Pyth is not structure, it is
publishers. There is one and it is us.** On devnet, settlement prices are ours
to assert and nothing on chain proves them. That is a real weakness and we are
not going to dress it up.

Three things bound it:

- Only the feed's declared publisher can write to it.
- Prices must move **strictly forward in time**, so a stale update cannot be
  replayed over a fresh one and roll the feed backwards.
- A confidence bound, enforced on write and again on read, mirroring the check
  the Pyth path applies to its interval.

And one thing it does not touch: **the strike**. That is still recomputed on
chain from its own published samples and owes the oracle nothing. The novel
part of this project is verifiable regardless of where prices come from.

### The price the market settles on

`publish_time` is always **when the source produced the price**, never when it
reached the chain. A price written a second ago carrying Friday's close is
stale and reads as stale. That distinction is the entire staleness check.

The crank sends `update_price` and `lock` in a **single transaction**, so the
reference price is zero seconds old by construction rather than however long
ago the publisher last ran. This is also how Pyth's pull oracle is meant to be
used, so it moves toward the mainnet design rather than around it.

Daily markets settle on the **official close**, set by the closing auction.
Hourly markets settle on the last trade. Confusing the two would settle on a
different definition than the strike was calibrated on.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  keeper/          AWS CDK, four scheduled lambdas               │
│                                                                 │
│   Publisher      every minute   writes PriceFeed[NVDA|TSLA|SPY] │
│   HourlyMarkets  09:00 ET       creates the session's markets   │
│   DailyMarkets   15:55 ET       creates close-to-close markets  │
│   Crank          every minute   lock / settle what is due       │
└───────────────────────────┬─────────────────────────────────────┘
                            │  signs with a key from SSM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  program/         Anchor, deployed to devnet                    │
│                                                                 │
│   Market    PDA ["market", ticker, session, tier]               │
│   Position  PDA ["position", market, user]                      │
│   Vault     PDA ["vault", market]    authority = market PDA     │
│   PriceFeed PDA ["price_feed", ticker]                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │  read directly, no indexer
                            ▼
                        frontend
```

**The frontend reads chain state directly.** No backend index, no API in
between. The data volume is tiny and every address is deterministic, so market
state, pool sizes, the 20 samples behind each threshold and the live price all
come from `getMultipleAccounts`. Nothing can be stale or disagree, and the
program is not decorative.

### Instructions

| | Who | What |
|---|---|---|
| `init_market` | admin | Creates a market with a strike verified against its samples |
| `deposit` | user | Into ABOVE or BELOW, until lock |
| `withdraw` | user | The escape hatch, until lock |
| `lock` | **anyone** | Records the reference price |
| `settle` | **anyone** | Records settlement, picks a side |
| `claim` | user | Winner's pro-rata share, or a refund from a voided market |
| `void_market` | **anyone** | Releases a market whose feed never recovered |
| `collect_fee` | anyone | Pushes a settled market's fee to its treasury |
| `init_faucet` `faucet_mint` | | devnet test token |
| `init_price_feed` `update_price` | publisher | devnet oracle |

`lock` and `settle` being permissionless is load bearing. We run a keeper, but
if it dies **anyone can crank a market forward with a short script**. The
protocol never waits on us, which is also the honest answer to a
centralisation question.

### Settlement maths

```
move_bps = |settlement - reference| × 10_000 / reference
above_wins = move_bps > strike_bps        // an exact tie goes to BELOW

pot           = above_pool + below_pool
distributable = pot - pot × fee_bps / 10_000
payout(user)  = user.amount × distributable / winning_pool
```

Every intermediate runs in u128. Integer division truncates, so the sum of
payouts is always at or just under what is distributable: the few base units
left behind are dust in the vault, which is the safe side to err on. The
alternative is a last claimant finding it empty.

### Edge cases, each with a test

| Situation | Behaviour |
|---|---|
| One pool empty at lock | Market voids, everyone refunds in full |
| Move exactly equals the strike | BELOW wins, stated in the docs and the UI |
| Double claim | Rejected |
| Oracle unreadable | `lock`/`settle` fail and can be retried, rather than killing the market |
| Feed never recovers | `void_market` after 6 hours, full refund, no fee |
| Claim on a voided market | Returns the original deposit, no fee taken |

---

## Denomination and the faucet

Markets are quoted in whatever SPL mint `init_market` is given. On devnet that
is **USDX**, a valueless test token with a self-serve faucet: 10,000 per claim,
24 hour cooldown.

The faucet PDA holds mint authority, so `faucet_mint` is the only path to
supply. There is a test asserting the deployer, who created the mint, can no
longer mint from it directly.

A faucet of our own rather than a dependency on an external one: judges may
test at 3am on a Sunday, and a dry third-party faucet at that hour means
nobody can trade at all.

Dollar denomination costs no optionality. `quote_mint` is a field and wSOL is
an SPL token, so SOL-denominated markets later need no program change. It also
keeps the product legible: pools in a volatile asset would hand someone
betting on NVDA volatility an unrelated SOL/USD exposure for two days.

---

## Deployed on devnet

```
Program      9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL
USDX mint    FBnaipfxQK8M3ZMMM3bwnzgbgKDLPGJ2rJdUANHocBve
Faucet       AR5q8xnQUeP9a9UcdjvXWAdaGxr8aFUBJuM1fPT8zfL9

PriceFeed    NVDA  AGHVsmmpSPawAVjdt6Kz8wTHYgjdhWsEtbAJ4Z1EqT8c
             TSLA  7MTEtbktfdVUNcXfkh1GqnHXz6WPd4iMRHHVFzmgSpsM
             SPY   RNTbijEkEUfyYtaBuKHqxRve11RFsSzETw3du6Yz6tQ
```

---

## Running it

```bash
# program: both build shapes are kept green
cd program
anchor build --arch v0 && cargo test                              # production, reads Pyth
anchor build --arch v0 -- --features keeper-oracle,devnet-faucet  # devnet
cargo test --features keeper-oracle,devnet-faucet

# keeper
cd keeper
npm install && npm test
npx tsx scripts/preflight.ts    # exercises the lambda code paths without deploying
npm run strikes                 # prints live ladders and the series behind them
```

`--arch v0` is not optional: Anchor 1.2 defaults to `--arch v3` and litesvm's
verifier rejects it, which surfaces as every test failing at `add_program`.

Tests run on **litesvm**, in process, with no validator. The whole suite is
under a second, which is what makes it worth running on every change.

```
program   53 tests    percentile verification, full lifecycle, payout maths, edge cases
keeper    70 tests    ladders, trading calendar, window validation, IAM scoping
```

---

## Honest limitations

Worth stating plainly rather than leaving to be discovered.

**Settlement prices on devnet are published by us.** Covered in full above.
Mainnet reads Pyth through the same seam, and the production build already
compiles that way.

**The strike is computed off chain and verified on chain.** The program proves
the strike matches its samples. It cannot prove the samples are real market
data. Publishing a hash of the raw source response is the natural next step.

**Hourly markets are intraday**, which is the measurement the daily product
deliberately rejects. They exist so the lifecycle is observable in minutes,
they carry their own calibration, and they are labelled as a separate
instrument.

**Single publisher, single source.** The `PriceFeed` account already carries a
`conf` field and a `source_count`, and the program enforces a disagreement
bound on both write and read. Wiring a second source is the smallest available
improvement to the trust model.

**Devnet only.** No mainnet deployment and no real funds at any point.

---

## Repository

```
docs/       product spec (EN and ES), public overview, execution roadmap
program/    Anchor program, tests, devnet setup scripts
keeper/     AWS CDK app: four lambdas, trading calendar, strike calibration
```

The roadmap in `docs/ROADMAP.md` includes the cut lines and risk register we
worked to, including the two Phase 0 findings that shaped the product: that
Pyth Benchmarks was unaffordable, and that measuring open to close makes
earnings invisible.

---

**MoveX Equities. Trade magnitude, not direction.**
