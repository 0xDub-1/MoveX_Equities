# MoveX Equities

**Daily volatility markets on US stocks. Trade how much a stock moves, not which way.**

> Status: spec for the Stocklana hackathon build (Solana Foundation, deadline Fri Sept 18 2026, 4:00pm ET).
> This document defines the product and the on-chain design. Spanish version: `PROJECT.es.md`.

---

## 1. What this is

Every trading day, for every listed ticker, we open a market on a single question:

> **How much will this stock move today?**

Not up. Not down. How much. You deposit USDC on one side of a threshold, the session plays out, and the side that was right splits the pot.

That's the whole product. No strikes ladder to learn, no greeks, no margin, no liquidations. One question per market, one number, one session.

---

## 2. The problem

Volatility is one of the most traded things in traditional finance. Buying a straddle before a catalyst is a standard retail options trade. Millions of people do it.

Onchain, nobody can do it.

Tokenized equities are arriving fast on Solana, and they let you express exactly one view: up or down. If your view is "NVDA is going to move hard and I don't know which way," there is no instrument for you. You either pick a direction you don't have conviction in, or you sit out.

Options protocols exist but they ask retail to understand strikes, expiries, greeks, and IV surfaces. That is a wall most people never climb.

MoveX Equities collapses volatility into a single number a normal person can reason about: **the stock moved 2.0% today, was that more or less than 1.55%?**

---

## 3. How a market works

### 3.1 The daily cycle

```
15:55 ET  (day D-2)   Strike computed from the trailing 20 sessions and frozen.
                      Market opens for deposits.
                          |
                          |   deposit window (~24 hours)
                          |   you can also withdraw freely here
                          ↓
16:00 ET  (day D-1)   LOCK. Deposits close.
                      Reference price is read from Pyth (that day's close).
                          |
                          |   overnight gap, then the full session
                          ↓
16:00 ET  (day D)     SETTLE. Settlement price is read from Pyth (the close).
                      move = |settlement - reference| / reference
                      Winning side is determined. Pot is distributable.
                          |
                          ↓
                      CLAIM. Winners withdraw their share anytime after.
```

We measure **close to close**, which is the number a normal person already means by "how much did it move today."

This is a deliberate choice over intraday (open to close), for one decisive reason: **intraday measurement makes earnings invisible.** A company reports after the close, the stock gaps 8% at the next open, then drifts flat through the session. An intraday market would record a 0.4% move and pay out BELOW on the most volatile day of the quarter. Close-to-close captures the gap, which is where a large share of single-stock volatility actually lives.

Both oracle reads land at 16:00 ET, a live market moment, so staleness handling stays simple.

One caveat we are not glossing over: whether a Pyth read at 16:00:00 returns the official closing print or the continuous price just before the closing auction is unverified, and it is being measured before settlement is frozen. See 11.

At any time two markets per rung are in flight: one locked and measuring, one open for deposits. There is always something to trade.

### 3.2 Two pools, no orderbook

There is no order book, no matching engine, and no continuous price. There are two pools, and you pick one:

```
Market: NVDA · session 2026-09-16 · strike 1.55%

     ┌──────────────────────┐   ┌──────────────────────┐
     │        ABOVE         │   │        BELOW         │
     │                      │   │                      │
     │  moves MORE than     │   │  moves LESS than     │
     │  1.55% (either way)  │   │  1.55%               │
     └──────────────────────┘   └──────────────────────┘
```

You are never matched against a specific counterparty. The opposite pool **is** your counterparty, collectively.

### 3.3 Odds come from the pool ratio

Nobody sets odds. They fall out of where the money sits.

```
ABOVE pool   $70,000
BELOW pool   $30,000
             ────────
POT          $100,000
```

The market is collectively saying "about 70% chance this is a big day."

| If this side wins | Payout multiple |
|---|---|
| ABOVE | 100k / 70k = **1.43x** |
| BELOW | 100k / 30k = **3.33x** |

Betting the unpopular side pays more. Standard parimutuel mechanics, same as horse racing or Polymarket-style pools.

### 3.4 Worked example

Alice deposits **$1,000 into BELOW** on the NVDA market above.

The reference close was 218.29. The next session closes at 213.90.

```
move = |213.90 - 218.29| / 218.29 = 2.01%
2.01% > 1.55%  →  ABOVE wins
```

Alice loses her $1,000.

Now flip it. NVDA closes at 220.15 instead:

```
move = |220.15 - 218.29| / 218.29 = 0.85%
0.85% < 1.55%  →  BELOW wins

Alice's share of the BELOW pool:  1,000 / 30,000 = 3.33%
Pot after 1% protocol fee:         $99,000
Alice receives:                    3.33% × 99,000 = $3,300
Profit:                            +$2,300   (ROI +230%)
```

---

## 4. The strike: computed, not invented

This is the part that makes or breaks credibility. If a human picks the threshold, the whole thing is arbitrary and the product is a casino with extra steps.

So no human picks it.

### 4.1 The formula

```
1. Take the last 20 completed trading sessions for the ticker.
2. For each, the absolute close-to-close move:  |close - prev_close| / prev_close
3. Sort the 20 values.
4. Read off the percentiles. Each one becomes a strike.
```

Step 2 measures the same thing the market settles on (3.1). Calibrating on
one definition and settling on another would silently misprice every rung.

We use **empirical percentiles**, not a volatility model. The property that matters: every strike carries its historical base rate **by construction**.

| Percentile | Sessions that exceeded it |
|---|---|
| P25 | 75% (15 of 20) |
| P50 | 50% (10 of 20) |
| P75 | 25% (5 of 20) |

This is arithmetic on the series, not an estimate. A user can verify it by counting.

**Why percentiles instead of standard deviations.** The conventional approach sets strikes as multiples of sigma. That assumes returns are normally distributed, and equity returns are not: they have fat tails, so a sigma-based ladder understates exactly the violent days that matter most to a volatility product. Reading empirical quantiles makes no distributional assumption at all.

For orientation: under normality the median absolute move equals roughly 0.67 sigma, and the P25 to P75 band spans roughly 0.32 to 1.15 sigma. Same territory as a sigma ladder, without assuming the distribution.

### 4.2 Worked example

The last 20 sessions of NVDA, absolute close-to-close move, sorted. Real data, window ending 2026-09-11:

```
0.03  0.06  0.07  0.33  0.84 │ 0.91  0.98  0.99  1.48  1.51 │ 1.59  1.80  2.01  2.19  2.34 │ 2.37  2.91  3.21  4.57  8.74
                             ↑                              ↑                              ↑
                        P25 = 0.89%                   P50 = 1.55%                    P75 = 2.35%
```

Those three numbers are the three strikes for the session. When a user asks "why 1.55%?", the answer is "because 10 of NVDA's last 20 sessions moved more than that and 10 moved less. Here are the 20 numbers." The UI shows the full series.

Note the 8.74% at the right edge, most likely an earnings day or a major headline. The median does not flinch at it. A mean or a standard deviation would have been dragged upward by that single session, which is precisely why the ladder is built on quantiles.

### 4.3 Illustrative calibration

Each ticker self-calibrates. No configuration, no manual tuning. Live values, close-to-close, 20-session window ending 2026-09-11:

| Ticker | TIGHT (P25) | FAIR (P50) | WIDE (P75) |
|---|---|---|---|
| SPY | 0.30% | 0.45% | 0.67% |
| NVDA | 0.89% | 1.55% | 2.35% |
| TSLA | 0.71% | 1.71% | 4.04% |

These drift every day as the window rolls forward. The window above is a relatively calm stretch for NVDA; in a volatile month the same calculation produces materially wider strikes without anyone touching a setting.

### 4.4 Honest disclosure about trust

The strike is computed **off-chain** by a keeper and passed into `init_market`. Storing 20 days of price history on-chain to compute it in-program would be prohibitively expensive for v1.

What makes this acceptable:

- The formula is public and deterministic. Anyone with free market data can reproduce it.
- The 20 input values are published in the UI alongside the market.
- The strike is **frozen at market creation** and cannot be mutated once deposits open. The program has no instruction to change it.

On-chain strike computation (or a committed-hash scheme) is a roadmap item, not a v1 claim. We say this plainly rather than pretending otherwise.

### 4.5 Earnings are not a special product

Under this model, an earnings day is just a session where the trailing percentiles happen to be wide. The strikes widen on their own, volume spikes on its own, and we build nothing extra.

That is the advantage of going daily instead of event-driven: **252 markets per ticker per year instead of 4.**

---

## 5. The strike ladder

### 5.1 Two sides, several strikes

These are two different things and the distinction matters:

```
A MARKET has 2 sides:        ABOVE / BELOW          always exactly two
A TICKER has N markets:      TIGHT / FAIR / WIDE    this is the ladder
```

Each rung of the ladder is its own independent binary market with its own two pools and its own vault. They do not share liquidity and they settle independently.

### 5.2 The rungs are percentiles

Each rung is an empirical percentile of the trailing 20 sessions (see 4.1). No multipliers, no hand-picked numbers.

| Tier | Percentile | Historical base rate of ABOVE | The question it asks |
|---|---|---|---|
| **TIGHT** | P25 | 75% | Does it move at all today? |
| **FAIR** | P50 | 50% | The coin flip. |
| **WIDE** | P75 | 25% | Is this a big day? |

```
NVDA · session 2026-09-16

┌─────────┬────────────┬────────┬───────┬────────┬──────────────┐
│ Tier    │ Percentile │ Strike │ ABOVE │ BELOW  │ Implied odds │
├─────────┼────────────┼────────┼───────┼────────┼──────────────┤
│ TIGHT   │    P25     │ 0.89%  │  $80k │  $20k  │  80% above   │
│ FAIR    │    P50     │ 1.55%  │  $70k │  $30k  │  70% above   │
│ WIDE    │    P75     │ 2.35%  │  $25k │  $75k  │  25% above   │
└─────────┴────────────┴────────┴───────┴────────┴──────────────┘
```

Read the implied odds column against the base rate column and you have a tradeable signal: here the market is pricing every rung above its historical frequency, which is a crowd leaning long volatility.

### 5.3 The ladder generates windows for free

Three strikes partition the outcome space into four windows, and because the strikes are quartiles, each window carries exactly 25% historical probability. This is what the UI shows:

```
NVDA · today

 ┌───────────┬───────────────┬───────────────┬───────────┐
 │  < 0.89%  │ 0.89 - 1.55%  │ 1.55 - 2.35%  │  > 2.35%  │
 │           │               │               │           │
 │    25%    │      25%      │      25%      │    25%    │
 └───────────┴───────────────┴───────────────┴───────────┘
     flat         quiet          active       wild day
```

The critical difference from true mutually exclusive buckets: **what is displayed is windows, what is traded is the three binary markets.**

To take the "1.55 to 2.35%" window, a trader buys ABOVE on FAIR and BELOW on WIDE. If the session lands at 2.4%, they win one leg and lose the other rather than going to zero over five hundredths of a percent. Real options markets work exactly this way: you see a strike ladder, and spreads and butterflies are constructed by combining rungs.

### 5.4 How many rungs: the scaling rule

The number of rungs is a liquidity decision, not a taste decision. Every rung splits the capital, and a pool with a few hundred dollars in it produces absurd payout ratios and a broken-looking UI.

| Rungs | Percentiles | Windows | When |
|---|---|---|---|
| 1 | P50 | 2 | New or illiquid ticker |
| **3** | **P25 / P50 / P75** | **4** | **Default** |
| 5 | P10 / P25 / P50 / P75 / P90 | 6 | Only once every existing pool is deep |

Rungs are added when existing pools clear a size threshold, never on a whim. Percentiles are always symmetric around P50 so the ladder never skews to one side.

**Implementation cost of the ladder: zero extra lines.** The program already supports N markets. Each rung is another call to `init_market` with a different strike.

For the hackathon demo we run the full three-rung ladder on NVDA and a single FAIR market on TSLA and SPY, so liquidity concentrates and the ratios look healthy on screen.

---

## 6. Architecture

Fully on-chain. No sequencer, no off-chain matching, no custody.

### 6.1 Accounts

```
Market  (PDA: ["market", ticker, session_date, tier])
├── underlying          ticker symbol
├── pyth_feed           Pyth price account for this equity
├── session_date        the trading day being measured
├── tier                Tight | Fair | Wide
├── strike_bps          e.g. 155 = 1.55%
├── state               Open | Locked | Settled | Voided
├── reference_price     written at lock
├── settlement_price    written at settle
├── above_pool          total USDC deposited above
├── below_pool          total USDC deposited below
├── winning_side        written at settle
├── fee_bps             protocol fee
├── lock_ts / settle_ts unix timestamps
└── bump

Position  (PDA: ["position", market, user])
├── user
├── market
├── side                Above | Below
├── amount              USDC deposited
├── claimed             bool
└── bump

Vault  (PDA token account owned by the market)
└── holds all USDC for this market
```

### 6.2 Instructions

| Instruction | Who | What it does |
|---|---|---|
| `init_market` | admin | Creates a market with its frozen strike and timestamps |
| `deposit` | user | Deposits USDC into ABOVE or BELOW. Only while `Open` and before `lock_ts` |
| `withdraw` | user | Pulls the deposit back out. Only before lock. The escape hatch |
| `lock` | anyone | Permissionless crank. Reads Pyth, stores `reference_price`, state → `Locked` |
| `settle` | anyone | Permissionless crank. Reads Pyth, computes move, sets winner, state → `Settled` |
| `claim` | user | Winner withdraws their pro-rata share |

`lock` and `settle` are permissionless on purpose. We run a keeper, but if it dies, anyone can crank the market forward. The protocol never gets stuck waiting on us.

### 6.3 Settlement math

```
move_bps = |settlement_price - reference_price| × 10_000 / reference_price

above_wins = move_bps > strike_bps        // exact tie goes to BELOW, stated explicitly

pot           = above_pool + below_pool
fee           = pot × fee_bps / 10_000
distributable = pot - fee

payout(user) = user.amount × distributable / winning_pool
```

### 6.4 Edge cases

| Situation | Behavior |
|---|---|
| One pool is empty at lock | Market is **voided**. Everyone refunds in full. A pot with no counterparty is not a market |
| Pyth price unavailable or too stale at lock or settle | Market is **voided**. Everyone refunds |
| `move_bps` exactly equals `strike_bps` | BELOW wins. Documented in the UI, no ambiguity |
| Nobody claims | Funds remain claimable indefinitely. No expiry, no sweep in v1 |
| Trading halt mid-session | Pyth stops updating, staleness check fires at settle, market voids and refunds |

Note what is structurally impossible here: you cannot lose more than you deposited, there is no margin, no liquidation, no bad debt, and therefore no insurance fund. The worst outcome for a user is losing their stake.

---

## 7. Why Solana

This is a judging criterion for the hackathon, so let us answer it properly rather than hand-waving.

**Pyth is native here.** Pyth was born on Solana. It publishes first-party equity price feeds updating every 400ms, free to consume, from the firms that actually make those markets. This is not a bridge relaying numbers from elsewhere. For a product whose entire payoff **is** the oracle reading, that matters more than anything else in the stack.

**Tokenized equities live here.** The ecosystem forming around onchain stocks on Solana is exactly the user base that needs a volatility instrument. We sit next to it, not away from it.

**The whole thing fits on-chain.** Compute and fees are cheap enough that the market, the vaults, the settlement, and the payouts all live in one program. No off-chain matching engine, no sequencer to trust, no custody. That is not true on most chains, and it is a meaningfully stronger trust story than our own EVM product.

---

## 8. Testing outside market hours

Pyth equity feeds only update during regular US market hours (09:30 to 16:00 ET, weekdays). Outside that window the feed returns the last close with a stale `publish_time`, and any sane staleness check rejects it.

This is a real development constraint. Three mitigations, all in scope:

**Mock oracle mode.** The program accepts a `MockPrice` account instead of a Pyth account when compiled with the `dev-oracle` feature. An admin can set arbitrary prices to drive a market through its full lifecycle in seconds. Compiled out of the mainnet build entirely, so it cannot be enabled in production.

**Crypto markets for always-on devnet.** Pyth's BTC and SOL feeds run 24/7. We keep a parallel set of crypto markets on devnet so there is always a live, real-oracle market to poke at on a Sunday. The settlement logic is identical, only the feed and session window differ.

**Record the demo during market hours.** The submission deadline is Friday 4:00pm ET, which is inside the session. We record the video with real equity feeds on Thursday or Friday morning, not the night before.

---

## 9. Scope

### In scope for the hackathon

- Anchor program: the six instructions above, fully on-chain
- Pyth integration with staleness and confidence-interval checks
- Mock oracle behind a dev feature flag
- Devnet deployment with seeded markets
- Keeper script: computes the strike from the trailing 20 sessions, calls `init_market`, cranks `lock` and `settle`
- Frontend reusing the existing MoveX design system: market list, deposit, position view, claim
- Shareable PnL card (ported from the existing MoveX implementation)
- Three tickers: NVDA (full ladder), TSLA and SPY (FAIR only)

### Explicitly out of scope for v1

- Order book and continuous pricing
- Secondary market / early exit after lock
- Leverage and margin
- On-chain strike computation
- Intraday (open to close) markets as a second product line
- Mainnet deployment

### Roadmap after the hackathon

1. **Transferable positions.** Turn a `Position` into a token so it can be sold before settlement. This is the cheapest path to an exit without building an order book.
2. **On-chain or committed strike.** Publish a hash of the input series at market creation so the strike becomes verifiable rather than merely reproducible.
3. **Intraday markets alongside the daily ones.** Close-to-close is the right default because it captures the gap, but a session-only market is a genuinely different instrument: it isolates intraday range from overnight risk. Worth offering once the daily markets have liquidity.
4. **Continuous markets.** A real order book with a live volatility price. This is MoveX proper, and it already exists on HyperEVM.

---

## 10. Relationship to MoveX

MoveX Equities is not a port of MoveX and not a lesser version of it. It is the same primitive expressed for a different user and a different market structure.

| | MoveX Equities (Solana) | MoveX (HyperEVM) |
|---|---|---|
| Market structure | Parimutuel pools | Order book, continuous price |
| User | Retail, takes a view and waits | Active trader, manages a position |
| Horizon | One session | Continuous, enter and exit freely |
| Risk | Capped at the deposit | Margin, leverage, liquidation |
| Underlying | US equities | Crypto |
| Trust surface | Fully on-chain | Off-chain matching, on-chain settlement |

Both answer the same question, which is the thesis of the whole company: **trade magnitude, not direction.**

---

## 11. Open questions

- **Does a Pyth read at 16:00 equal the official close?** Unverified, and the most important thing on this list. The official close comes from the closing auction at 16:00:00, which prints seconds to minutes later, so a read at exactly 16:00:00 catches the continuous market just before it. Since strikes are calibrated on official closes, settling on anything else means calibrating against one definition and settling against another, which is what 4.1 warns about. Being measured against the live feed before settlement logic is frozen. See `ROADMAP.md`, Phase 3.
- **Fee level.** 1% of the pot is the placeholder. Needs a decision before mainnet, not before the hackathon.
- **Rung promotion threshold.** The scaling rule in 5.4 says rungs are added once pools are deep enough, but the actual dollar threshold is unset. Needs real usage data.
- **Minimum viable pot.** Below some pool size the ratios get silly. Consider a floor under which the market voids at lock.
- **Lookback window.** 20 sessions is the standard choice, but shorter windows react faster to regime changes. EWMA (RiskMetrics, lambda 0.94) is the natural upgrade, at the cost of losing the "count the numbers yourself" verifiability that makes percentiles so easy to defend.
- ~~**Percentile interpolation.**~~ Resolved. With 20 samples P25 and P75 fall between observations, so the keeper interpolates linearly between the two neighbours. Picking the nearer observation instead would bias P50 to one side of the distribution, which is the one rung that has to be a genuine coin flip. The convention is pinned by tests against the published NVDA series.
