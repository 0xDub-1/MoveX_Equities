# MoveX Equities: Execution Roadmap

**Window:** Sunday Sept 13 → Friday Sept 18, 16:00 ET (submission deadline).
**Working time:** roughly 4.5 days.

The ordering principle: **unknowns before work.** Anything we have never done before gets attacked first, while there is still time to change course. Anything we already know how to build gets scheduled later, because its only risk is hours.

---

## Hard rules

These do not bend, regardless of schedule pressure.

1. **Every phase ends with something that runs.** Not "mostly working." Runs, with a passing test or a visible output.
2. **No phase starts before its predecessor's exit criteria are met.** If we are behind, we cut scope inside a phase, we do not skip it.
3. **Devnet only.** No mainnet deployment, no real funds, at any point.
4. **The demo is recorded during US market hours.** Thursday or Friday morning. Never the night before.
5. **The strike is always computed from real data.** If the pipeline breaks we fix the pipeline. We never hardcode a threshold to make a demo look finished.

---

## Phase 0: Data spike — COMPLETE

**When:** Sunday. Done.
**Why first:** this was the only genuine unknown in the project. Attacking it first produced two findings that would have been expensive to discover on Wednesday.

### Finding 1: Pyth Benchmarks is out, Yahoo is in

Pyth Benchmarks now requires an API key with no free tier. The Starter plan is $500/month, far outside a hackathon budget.

This matters less than it first appears, because two separate needs were conflated:

| Need | Runs | Affected |
|---|---|---|
| 20 sessions of history, to compute the strike | Off-chain keeper | Yes, needs a new source |
| Reference and settlement prices | On-chain, inside the program | **No.** Pyth price feeds on Solana are free to read |

Only the historical calibration needed a new provider. Settlement is untouched.

**Providers evaluated:**

| Provider | Verdict |
|---|---|
| Pyth Benchmarks | Rejected. $500/month, no free tier |
| Stooq | Rejected. Now serves a JavaScript proof-of-work challenge, unusable from a script |
| **Yahoo Finance chart API** | **Selected.** No key, no signup, returns daily OHLC as JSON, verified working |

We need three requests per day total, one per ticker, each returning months of bars. Any free tier covers this comfortably.

The `PriceHistoryProvider` interface stays. Yahoo is unofficial and could change without warning, so the adapter boundary is load-bearing insurance, not architecture astronautics.

### Finding 2: measurement must be close-to-close, not open-to-close

The spike computed both, on live data:

| Ticker | Open to close (FAIR) | Close to close (FAIR) |
|---|---|---|
| NVDA | 1.03% | **1.55%** |
| TSLA | 1.21% | **1.71%** |
| SPY | 0.20% | **0.45%** |

Bigger numbers are the lesser reason. The decisive one:

**Measuring open-to-close makes earnings invisible.** A company reports after the close, the stock gaps 8% at the next open, then drifts flat through the session. An open-to-close market would record a 0.4% move and pay out BELOW on the most volatile day of the quarter. That breaks the central claim that earnings require no special handling.

Close-to-close also matches what a normal person already means by "how much did it move today," which is the number shown on every finance site.

**Impact on the program: none.** The instructions only care about `lock_ts` and `settle_ts`. Only the keeper's scheduling changes, and the docs.

### Consequence: the cycle shifts

```
close(D-1)   Deposits close. LOCK. Reference price recorded.
                 |
                 |   overnight gap, then the full session
                 ↓
close(D)     SETTLE. Settlement price recorded. A side wins.
```

Deposits for a market run the full 24 hours before its reference is taken. At any moment two markets per rung are in flight: one locked and measuring, one open for deposits. Users always have something to bet on.

Both oracle reads land at 16:00 ET, a live market moment, so staleness handling stays simple.

### Calibrated strikes, live data, 20 sessions to 2026-09-11

| Ticker | TIGHT (P25) | FAIR (P50) | WIDE (P75) |
|---|---|---|---|
| NVDA | 0.89% | 1.55% | 2.35% |
| TSLA | 0.71% | 1.71% | 4.04% |
| SPY | 0.30% | 0.45% | 0.66% |

These drift daily as the window rolls. The current window is a relatively quiet stretch for NVDA.

### Remaining Phase 0 work

- Port the spike into the repo as a proper script with the `PriceHistoryProvider` interface.
- Trading calendar handling: assert 20 distinct sessions and print the dates, so a holiday bug cannot pass silently.
- Emit the JSON contract below.

### Output

```json
{
  "session": "2026-09-15",
  "tickers": {
    "NVDA": {
      "samples": [0.8, 1.1, 1.2, "... 20 values"],
      "strikes": { "tight": 1.7, "fair": 2.6, "wide": 3.7 }
    }
  }
}
```

The `samples` array is not debug output. It ships to the UI as the public justification for the threshold, so it is a first-class field.

### Exit criteria

`npm run strikes` prints three real strikes plus the 20-session series for all three tickers, computed from live historical data. **Met by the spike; formalising it in the repo is the remaining work.**

---

## Phase 1: Program skeleton and deposits

**When:** Monday.

### Tasks

- Anchor workspace scaffold.
- Accounts: `Market`, `Position`, and the vault PDA.
- Instructions: `init_market`, `deposit`, `withdraw`.
- Tests covering the deposit path.

### Exit criteria

A localnet test creates a market, has two wallets deposit on opposite sides, has one of them withdraw before lock, and asserts every balance and pool total is exactly right.

---

## Phase 2: Lifecycle and settlement

**When:** Tuesday. The highest-risk code in the program.

### Tasks

- **Mock oracle first**, behind a `dev-oracle` feature flag. Building this before touching Pyth means the entire lifecycle is testable in seconds, on a Sunday, in a loop, without waiting on market hours. This ordering is deliberate.
- Instructions: `lock`, `settle`, `claim`.
- Payout math, verified against hand-computed numbers.
- Edge cases, each with its own test:
  - One side empty at lock, market voids, everyone refunds in full
  - Move exactly equal to the strike, BELOW wins
  - Double claim attempt, rejected
  - Claim on a voided market, returns the original deposit

### Exit criteria

A cradle-to-grave test runs init, deposits on both sides, lock, settle, and claim, and asserts payouts to the smallest unit. The void path refunds correctly. Every edge case above has a passing test.

---

## Phase 3: Real oracle and devnet

**When:** Wednesday morning.

### Where the keeper runs

**Decision: AWS Lambda plus EventBridge Scheduler.**

The keeper is a cron job, not a service. Its entire daily workload is two invocations of roughly twenty seconds each: one before the close to compute strikes and open tomorrow's markets, one at the close to lock and settle. Provisioning a instance for that means paying for 43,200 minutes of idle to buy 40 seconds of work.

| Resource | Monthly use | Free tier | Utilisation |
|---|---|---|---|
| Lambda | ~60 invocations, ~150 GB-s | 400,000 GB-s | 0.04% |
| EventBridge Scheduler | ~60 | 14,000,000 | negligible |

Cost is zero, and permanently so: the Lambda free tier does not expire after twelve months.

The deciding factor beyond cost is that we already run CDK on this account for another stack, so this is a known pattern with no new learning curve during a week that has no slack in it.

**Timezone handling is not optional.** EventBridge Scheduler supports a native timezone:

```ts
scheduleExpression: 'cron(0 16 ? * MON-FRI *)',
scheduleExpressionTimezone: 'America/New_York',
```

US market close is 16:00 ET, which is 20:00 UTC in summer and 21:00 UTC in winter. A UTC cron silently drifts an hour on the first Sunday of November and every settlement after that reads the wrong price. Declaring the timezone makes AWS absorb the change.

Cron cannot express market holidays, so the Lambda checks whether today is a trading session on entry and exits early if not.

**Keys.** For devnet, a throwaway keypair in a Lambda environment variable. Secrets Manager protects nothing of value here. That changes for mainnet and belongs to a later decision.

**Failure mode.** `lock` and `settle` are permissionless by design. If the keeper dies, anyone can crank a market forward with a short script. The keeper is a convenience, not a single point of failure, which is also the honest answer to a centralisation question.

**Alternatives rejected:**

| Option | Why not |
|---|---|
| EC2 | Paying for an always-on machine to do 40 seconds of daily work |
| GitHub Actions | Free and infra-less, but its cron routinely drifts 5 to 30 minutes. Unacceptable jitter for a settlement anchored to the exact close |
| Fly, Railway, Render | Around $5/month to keep something running that does not need to be running |
| Local machine | Dies when the laptop closes. Judges may test at 3am on a Sunday |

**Open question for this phase:** how long do Pyth equity publishers keep sending after 16:00 ET? If after-hours prices continue to arrive, reading late would capture a post-close price rather than the close itself. This determines our staleness tolerance and must be measured against the live feed, not assumed.

### Tasks

- Swap the mock for real Pyth reads in the non-dev build. The mock remains, compiled out of anything but dev.
- Staleness and confidence-interval checks, with voiding on failure.
- Deploy to devnet.
- Keeper script: reads Phase 0 strikes, calls `init_market` for each rung, cranks `lock` and `settle` on schedule.
- Seed the markets: NVDA with the full three-rung ladder, TSLA and SPY with FAIR only.
- Seed a parallel crypto market so there is always a live market to demo outside market hours.

### Exit criteria

Real markets exist on devnet, created by the keeper from real computed strikes, and the keeper successfully locks and settles at least one market end to end.

---

## Phase 4: Frontend

**When:** Wednesday afternoon through Thursday afternoon.

Mostly assembly. The MoveX design system carries over wholesale, so the genuinely new work is the Solana wallet adapter.

### Tasks

- Solana wallet adapter. This is new plumbing, budget half a day and do it first.
- Market list showing the four-window visual with live pool ratios.
- The 20-session series displayed next to each market as the threshold justification.
- Deposit flow.
- Position view and claim.
- Port the PnL share card from MoveX.

### Exit criteria

A person who has never seen the app can connect a wallet, deposit into a side, see their position, and claim after settlement, without anyone explaining anything to them.

---

## Phase 5: Demo and submission

**When:** Thursday evening through Friday morning.

### Tasks

- Record the demo video during market hours, with real equity feeds live.
- README: what it is, how the threshold is derived, how to run it.
- Submit. Include repo link, live demo link and video.

### Exit criteria

Submitted before 16:00 ET Friday, with buffer, not at 15:58.

---

## Cut lines

If we fall behind, we cut in this exact order. Deciding this now removes the panic decision later.

**Cut first, costs nothing:**
- PnL share card port
- The three-rung ladder on TSLA and SPY, keep FAIR only
- Animations and visual polish

**Cut second, hurts but survivable:**
- The `withdraw` instruction. Nice for users, not required to demonstrate the product.
- The crypto parallel markets, if equity feeds are cooperating.

**Never cut, under any circumstance:**
- Correct settlement math
- Real strike computation from real data
- A working claim path

A demo where the user cannot collect their winnings is not a demo of this product. It is a demo of a deposit box.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| ~~Pyth API key unavailable~~ | Confirmed | Resolved. Yahoo adapter selected, verified working |
| Yahoo endpoint changes or rate limits us | Low | Unofficial API, but 3 requests/day. Provider interface makes swapping a one-file change |
| Anchor account-model learning curve | Medium | Phases 1 and 2 are deliberately generous. Rust fluency helps, the account model is the real cost |
| Equity feeds stale during development | Certain, every evening and weekend | Mock oracle built in Phase 2 before any Pyth work. Crypto markets as a live backstop |
| Wallet adapter eats more than half a day | Medium | Scheduled first within Phase 4, so overrun is visible early |
| Trading calendar bugs corrupting strikes | Medium | Assert 20 distinct weekday non-holiday sessions before accepting output. Print the dates |
| Demo recorded outside market hours | Low, but fatal to credibility | Hard rule 4. Thursday during session |

---

## Sequence at a glance

```
SUN   Phase 0   Data spike. DONE. Two findings: Yahoo over Pyth
                Benchmarks, and close-to-close over open-to-close.
                → real strikes computed from live data ✓

MON   Phase 1   Program skeleton, deposits
                → localnet deposit test green

TUE   Phase 2   Mock oracle, lock, settle, claim, edge cases
                → cradle-to-grave test green

WED   Phase 3   Real Pyth, devnet deploy, keeper (morning)
      Phase 4   Wallet adapter, market list (afternoon)
                → live markets on devnet

THU   Phase 4   Deposit, position, claim UI
      Phase 5   Record demo during market hours
                → full flow works in a browser

FRI   Phase 5   README, submit with buffer
                → submitted well before 16:00 ET
```

---

## Immediate next action

Phase 0 answered its question, so there is no longer an external dependency blocking anything. Next is porting the spike into the repo behind the provider interface, then straight into Phase 1.
