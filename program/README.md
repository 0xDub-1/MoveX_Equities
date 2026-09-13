# MoveX Equities program

Anchor program for daily volatility markets on US stocks. Two pools per
market, no order book, no leverage, no liquidations.

## Build

```bash
# production shape: no mock oracle, no faucet
anchor build --arch v0 && cargo test

# devnet shape: everything
anchor build --arch v0 -- --features dev-oracle,devnet-faucet
cargo test --features dev-oracle,devnet-faucet
```

Both shapes are kept green. The production one is the check that matters:
it proves the shipped binary contains no instruction that can write a price
or mint the quote asset. Features, not runtime flags, because a runtime
switch is one bad admin transaction away from settling real money against a
number somebody typed in.

**`--arch v0` is not optional.** Anchor 1.2 defaults to `--arch v3`, and
litesvm 0.10's verifier rejects SBPF v3: the tests fail at `add_program` with
`InvalidAccountData`, which looks like a broken test rather than a broken
build. v0 is also the format every cluster accepts, so one artifact serves
both testing and deployment.

Tests run on litesvm, in process, with no validator. The whole suite is well
under a second, which is what makes it worth running on every change.

## The strike is verified, not trusted

`init_market` receives a strike **and** the 20 sessions it was derived from,
then recomputes the percentile itself and rejects the market unless the two
agree.

```
P25 = (s[4]·25  + s[5]·75)  / 100
P50 = (s[9]·50  + s[10]·50) / 100
P75 = (s[14]·75 + s[15]·25) / 100
```

A percentile at `idx = p·(n-1)` over 20 samples always lands on a clean
quarter, so the weights are exact hundredths and the whole thing stays in
integers. No floating point enters the program, and the keeper reproduces it
bit for bit: `keeper/lib/lambdas/strikes/strikes.ts` carries the same table
and the same fixture.

That is the difference between "trust our formula" and a constraint. A keeper
cannot publish a series and quote a strike the series does not produce,
whether by bug or by choice. What stays trusted is only that the samples are
real market data.

## Layout

```
programs/movex-equities/src/
  constants.rs    seeds, fee ceiling, minimum deposit
  state.rs        Market, Position, Tier / MarketState / Side
  strike.rs       the percentile check, with the NVDA fixture
  error.rs
  instructions/
    init_market.rs   admin creates a market with a verified strike
    deposit.rs       into ABOVE or BELOW, until lock
    withdraw.rs      the escape hatch, until lock
tests/
  test_deposit_path.rs
```

## Accounts

```
Market    PDA ["market", ticker, session_date, tier]
Position  PDA ["position", market, user]
Vault     PDA ["vault", market]   token account, authority = market PDA
```

One position per user per market, so a user holds a side rather than both.
Once a full withdrawal takes the balance to zero the side is free again,
which keeps "withdraw and change my mind" working.

## Denomination

Markets are quoted in whatever SPL mint `init_market` is given. On devnet
that is USDX, a valueless test token with a self-serve faucet: 10,000 per
claim, 24 hour cooldown, mint authority held by a program PDA so
`faucet_mint` is the only path to supply.

A faucet of our own rather than a dependency on an external one. Judges may
test at 3am on a Sunday, and a dry third-party faucet at that hour means
nobody can trade at all.

Choosing a dollar-denominated token costs no optionality. `quote_mint` is a
field, and wSOL is an SPL token, so SOL-denominated markets later need no
program change. It also keeps the product legible: pools denominated in a
volatile asset would hand a user betting on NVDA volatility an unrelated
SOL/USD exposure for the duration.

## Status

Phases 1 and 2 are complete, 53 tests:

| | |
|---|---|
| `init_market` `deposit` `withdraw` | market creation and the deposit path |
| `lock` `settle` `claim` | the full lifecycle, behind a mock oracle |
| `void_market` | releases a market whose feed never recovered |
| `collect_fee` | pushes a settled market's fee to its treasury |
| `init_faucet` `faucet_mint` | devnet test token |

Phase 3 replaces the mock oracle with Pyth, adds staleness and
confidence-interval checks, and deploys to devnet.
