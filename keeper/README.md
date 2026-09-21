# MoveX Equities Keeper

Calibrates the daily strike ladder for each listed ticker and, from Phase 3,
opens and cranks the markets built on it.

The keeper is a cron job, not a service. Its entire daily workload is a few
seconds of work, so it runs on Lambda behind EventBridge Scheduler rather
than on an instance billed for 43,200 idle minutes to buy it.

## Where the threshold comes from

Take the last 20 completed sessions, measure how far the stock moved in each
one ignoring direction, sort them, and read off the quarter, half and
three-quarter marks.

```
NVDA, 20 sessions to 2026-09-11, sorted

0.03  0.06  0.07  0.33  0.84   0.91  0.98  0.99  1.48  1.51   1.59  1.80  2.01  2.19  2.34   2.37  2.91  3.21  4.57  8.74
                         ↑                             ↑                             ↑
                    P25 = 0.89%                   P50 = 1.55%                   P75 = 2.35%
                       TIGHT                         FAIR                          WIDE
```

Each rung's base rate is true by construction rather than by assertion: P25
means exactly a quarter of recent sessions moved more than that. Nobody picks
the number, and the 20 values it came from ship to the UI next to it.

Moves are measured **close to close**, not open to close. Measuring inside
the session would make earnings invisible: a company reports after the bell,
the stock gaps 8% at the next open and drifts flat, and an open-to-close
market records a 0.4% move on the most volatile day of the quarter.

## Running it

```bash
npm install
npm run strikes            # human-readable ladders and full session series
npm run strikes -- --json  # the report contract the keeper emits
npm test                   # 39 tests, no network
npm run typecheck
```

`npm run strikes` runs the exact code path the scheduled Lambda runs. The only
difference is output formatting, so a green run locally is evidence about the
keeper and not just about the script.

## Deploying

```bash
npx cdk deploy
```

Stack name is `MoveXEquitiesKeeper`. Account and region resolve from the CLI
profile at synth time, so nothing is pinned into the repo.

`esbuild` is a dev dependency, which keeps `NodejsFunction` bundling local
instead of falling back to Docker.

## What runs, and when

| Resource | Schedule | Does |
|---|---|---|
| `PublisherLambda` | every minute, MON-FRI, `America/New_York` | Writes each equity's PriceFeed from the Yahoo quote |
| `HourlyMarketsLambda` | 20:00 and 09:00 ET, MON-FRI | Creates the next session's intraday markets, with a morning backstop |
| `DailyMarketsLambda` | 15:55 and 09:00 ET, MON-FRI | Creates the next close-to-close ladders, with a morning backstop |
| `CrankLambda` | every minute, MON-FRI | Locks and settles due equities markets |
| `SeederLambda` | every 10 minutes, 09:00 to 20:00 ET, MON-FRI | Devnet. Funds both sides from seed wallets 0 to 5, claims |
| `CryptoPublisherLambda` | every minute, `Etc/UTC` | Writes each crypto asset's PriceFeed from the Hyperliquid mid |
| `CryptoMarketsLambda` | 7 past, every 10 minutes, `Etc/UTC` | Creates the hourly markets for the next four hours and tomorrow's daily ladder, then funds both sides from seed wallets 6 to 11 and claims |
| `CryptoCrankLambda` | every minute, `Etc/UTC` | Locks and settles due crypto markets on the Hyperliquid mid |
| `ComputeStrikesLambda` | on demand | Calibrates every equity's ladder, logs it |

The equities timezone is declared rather than baked into a UTC cron. US close
is 16:00 ET, which is 20:00 UTC in summer and 21:00 UTC in winter. A UTC cron
silently drifts an hour on the first Sunday of November, and every settlement
after that reads the wrong price. Crypto keeps UTC because its markets do: an
hourly market locks on the hour and settles on the next, a daily one locks at
midnight UTC and settles at the midnight after.

## The crypto venue

Same program, same wallet, same stack, and nothing else shared: its own
lambdas, its own schedules, its own block of seed wallets. An exception on
one side never delays the other's settle.

Listing an asset is one line in `lib/lambdas/shared/crypto-config.ts`, one run
of `program/scripts/init-feeds.ts` with the symbol added to its list, and one
line in the frontend's registry. Everything else derives from the registry:
which feeds the publisher writes, which hourly and daily markets exist, which
candidates the crank and the seeder walk.

Prices are Hyperliquid mids, read with one `allMids` call for every listed
asset. Ladders come from `candleSnapshot`, 1h bars for hourly markets and 1d
bars for daily ones, recalibrated from the last twenty closed bars every time
a market is created; `startTime` is mandatory on that endpoint. The bar in
progress is dropped before anything is measured. Lock and settle record the
same mid the ladder was calibrated on.

Hourly ids carry the year, `260921-18`, because a market's address is derived
from its id and the account never goes away; the equities form would collide
with itself twelve months later. Nine characters still read as hourly and ten
as daily everywhere ids are read.

```bash
npx tsx scripts/crypto-preview.ts        # ladders, slots and candidates right now
RPC_URL=... npx tsx scripts/crypto-preview.ts   # plus which of them exist on chain
RPC_URL=... npx tsx scripts/crypto-tick.ts      # one tick by hand: publisher, markets, crank
```

Cron cannot express market holidays. It does not matter yet: on a holiday the
provider returns no new session, so the trailing window is unchanged and the
recomputed ladder is identical. It starts mattering in Phase 3, when this also
opens markets, and the check moves into the handler.

## Layout

```
bin/keeper.ts              CDK app entry
lib/keeper-stack.ts        Lambda plus EventBridge Schedule
lib/lambdas/strikes/
  config.ts                lookback, percentiles, which rungs each ticker lists
  providers/types.ts       PriceHistoryProvider, the swap boundary
  providers/yahoo.ts       the only file that knows where bars come from
  sessions.ts              close-to-close moves plus window validation
  strikes.ts               percentile maths, pure and network-free
  report.ts                orchestration, emits the report contract
  handler.ts               Lambda entry, Powertools logging
scripts/strikes.ts         npm run strikes
```

## Two things that would fail silently, and do not

**The in-progress session cannot enter the window.** The provider takes an
exclusive `before` date and drops anything on or after it. The keeper fires at
15:55 ET while the session is still open, and vendors happily return today's
partial bar with a "close" that is really just the last print. Calibrating
tomorrow's threshold against a price that never existed as a close would
produce a plausible-looking number and no error.

**A corrupted window is refused, not calibrated.** Wrong session count,
duplicate dates, out-of-order dates, weekends and non-positive closes all
throw. Wide calendar gaps and implausible moves warn instead, because a market
holiday and a dropped session look identical from here, and we would rather
log a Thanksgiving than refuse to open markets over one. Every date in the
window is printed, so a calendar bug has to survive being looked at.

## Provider

Yahoo's chart endpoint. No key, no signup, three requests per day.

Pyth Benchmarks was the obvious choice and is out: $500/month with no free
tier. Stooq now serves a JavaScript proof-of-work challenge. Only the
*historical* calibration needed a new source; settlement prices come from Pyth
on-chain and never pass through here.

Yahoo is unofficial and can change without notice. That risk is bounded by
`PriceHistoryProvider`: nothing above it knows where bars come from, so
replacing it is a one-file change.

## Not built yet

`lock` and `settle` cranking, and the `init_market` calls, land in Phase 3
once the Anchor program exists. A second lambda on a 16:00 ET schedule will
carry them.

They are deliberately absent rather than stubbed. A scheduled job that logs
"not implemented" every weekday is noise pretending to be progress.

`lock` and `settle` are permissionless by design, so if the keeper dies anyone
can crank a market forward with a short script. It is a convenience, not a
single point of failure.
