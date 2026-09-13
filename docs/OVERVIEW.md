# MoveX Equities

**Trade how much a stock moves. Not which way.**

---

## The idea in one line

Every trading day, for every ticker we list, there is one market and one question:

> **How much will this stock move today?**

You take a side. The session plays out. The side that was right splits the pot.

---

## The problem

Volatility is one of the most heavily traded things in traditional finance. Buying a straddle before a catalyst is a standard trade that millions of people place every year. The view being expressed is simple and extremely common:

> *"Something big is about to happen to this stock. I am confident it moves hard. I have no idea which direction."*

Onchain, there is no way to express that view.

Tokenized equities are arriving fast, and they give you exactly one lever: up or down. If you do not have a directional opinion, your options are to fake one you do not believe, or to sit the day out.

The traditional answer is options, and options ask a normal person to learn strikes, expiries, implied volatility and greeks before they can place a single trade. Most people never climb that wall, and the ones who do are not learning it to trade a single Tuesday.

MoveX Equities collapses all of that into one number anybody can reason about:

> *NVDA moved 2.0% today. Was that more or less than 1.55%?*

---

## How it works

### The daily cycle

```
Market opens              The threshold is calculated and locked in.
                              |
                              |   you deposit on the side you believe
                              |   you can also pull your deposit back out
                              ↓
Today's close             Deposits close. The starting price is recorded.
                              |
                              |   overnight, then tomorrow's full session
                              ↓
Tomorrow's close          The finishing price is recorded.
                          The move is measured. A side wins.
                              |
                              ↓
                          Winners collect their share.
```

We measure close to close, which is exactly the daily move you already see on any finance site. It also means that when a company reports earnings after the bell and the stock gaps at the open, that move counts. Measuring only the trading session would miss it entirely.

### Two sides, one pot

There is no order book and no counterparty to find. There are two pools, and you pick one.

```
NVDA · today · threshold 1.55%

     ┌──────────────────────┐   ┌──────────────────────┐
     │        ABOVE         │   │        BELOW         │
     │                      │   │                      │
     │  moves MORE than     │   │  moves LESS than     │
     │  1.55%, either       │   │  1.55%               │
     │  direction           │   │                      │
     └──────────────────────┘   └──────────────────────┘
```

Direction is irrelevant. A stock that drops 4% and a stock that rips 4% pay out identically. All that matters is distance travelled.

### The odds come from the crowd

Nobody sets the payouts. They fall out of where the money sits.

```
ABOVE     $70,000
BELOW     $30,000
          ────────
POT       $100,000
```

The crowd is collectively saying there is roughly a 70% chance this is a big day.

| If this side wins | Payout |
|---|---|
| ABOVE | 100k / 70k = **1.43x** |
| BELOW | 100k / 30k = **3.33x** |

Backing the unpopular side pays more. The less the crowd agrees with you, the better your price.

### A full example

Alice puts **$1,000 on BELOW**. She thinks today is quiet.

NVDA starts from a close of 218.29 and finishes the next session at 220.15.

```
Move:  |220.15 - 218.29| / 218.29  =  0.85%

0.85% is below the 1.55% threshold  →  BELOW wins

Alice's share of the BELOW pool:   $1,000 / $30,000  =  3.33%
Pot after a 1% protocol fee:       $99,000
Alice collects:                    $3,300
Profit:                            +$2,300
```

If NVDA had closed at 213.90 instead, that is a 2.01% move, ABOVE wins, and Alice loses her $1,000. That is the entire range of outcomes. There is nothing else that can happen to her position.

---

## Where the threshold comes from

This is the part that decides whether the product is serious or a coin flip with a logo.

If a person picks the threshold, everything downstream is arbitrary. So no person picks it.

The threshold is read straight out of the stock's own recent behaviour:

```
1. Take the last 20 trading sessions.
2. Measure how far the stock moved in each one, ignoring direction.
3. Sort those 20 numbers.
4. Read the middle one.
```

Here is NVDA's last 20 sessions, sorted. Real numbers, taken the week of 11 September 2026:

```
0.03  0.06  0.07  0.33  0.84   0.91  0.98  0.99  1.48  1.51   1.59  1.80  2.01  2.19  2.34   2.37  2.91  3.21  4.57  8.74
                                                     ↑
                                             middle = 1.55%
```

So the threshold is 1.55%, and it carries a property that makes it genuinely fair: **exactly half of NVDA's recent sessions moved more than that, and half moved less.** It is a coin flip calibrated on the stock's own behaviour, not an opinion about the future.

When somebody asks why the number is 1.55%, the answer is not a model or a formula they have to trust. It is *"because 10 of the last 20 days were bigger and 10 were smaller, and here are all 20 numbers."* The full series sits on screen next to the market.

Look at the 8.74% on the right edge. A single violent session, and the threshold does not care, because the middle of a sorted list cannot be dragged around by one extreme value. An average would have been.

Every ticker calibrates itself. Nobody tunes anything.

| Ticker | Threshold |
|---|---|
| SPY | 0.45% |
| NVDA | 1.55% |
| TSLA | 1.71% |

These move every day as the window rolls forward. A calm month narrows them, a violent one widens them, and nobody touches a setting either way.

### Earnings take care of themselves

A day where a company reports is simply a day where those recent sessions were violent, so the threshold widens on its own. There is no separate earnings product, no special case, no manual intervention. It is just a Tuesday with a wider number.

That is the difference between a product that works four days a year per ticker and one that works 252.

---

## More than one threshold

A single threshold per day would be a thin market, so each ticker runs three, taken from the same sorted list of recent sessions. Instead of just the middle value, we also read the quarter marks.

```
NVDA · today

┌──────────┬───────────┬────────────────────────────┬──────────────┐
│ Market   │ Threshold │ The question               │ Base rate    │
├──────────┼───────────┼────────────────────────────┼──────────────┤
│ TIGHT    │  0.89%    │ Does it move at all?       │ 75% of days  │
│ FAIR     │  1.55%    │ The coin flip.             │ 50% of days  │
│ WIDE     │  2.35%    │ Is today a big one?        │ 25% of days  │
└──────────┴───────────┴────────────────────────────┴──────────────┘
```

Three thresholds carve the day into four outcomes, each historically just as likely as the others:

```
 ┌───────────┬───────────────┬───────────────┬───────────┐
 │  < 0.89%  │ 0.89 - 1.55%  │ 1.55 - 2.35%  │  > 2.35%  │
 │           │               │               │           │
 │    25%    │      25%      │      25%      │    25%    │
 └───────────┴───────────────┴───────────────┴───────────┘
     flat         quiet          active       wild day
```

Four equal boxes at the open, which the money then distorts as the day approaches. The gap between what history says and what the crowd is paying is, in itself, the signal.

And because these are three independent markets rather than four sealed boxes, you can combine them. If your view is *"normal day, neither dead nor crazy"*, you back ABOVE on TIGHT and BELOW on WIDE and you have built that range yourself. If the day comes in at 2.4% instead of 2.3%, you win one leg and lose the other rather than being wiped out by five hundredths of a percent.

---

## What cannot happen to you

Worth stating plainly, because it is unusual for a derivatives product:

- **You cannot lose more than you put in.** There is no margin and no borrowing.
- **You cannot be liquidated.** There is no position to margin call.
- **You cannot be wrong about direction.** The product does not have a direction.
- **You cannot get stuck.** Deposits are refundable right up until the session begins.

The worst outcome available to you is losing the stake you chose. That is the whole risk surface.

---

## Why this matters

Volatility is the most widely discussed thing in trading and one of the least accessible. Everybody has an opinion about whether a week will be violent or dull. Almost nobody has a clean way to act on it, and the people who do are using instruments built for institutions.

There is also a structural gap worth noticing. As real equities move onchain, the instruments following them are all directional: buy the token, short the token. The entire second dimension of the market, the one that professionals spend most of their time on, is missing.

MoveX Equities fills it with a product a first-time user can understand in about thirty seconds.

---

## Where this sits

MoveX is built on a single idea: **trade magnitude, not direction.** We already run that idea as a full trading venue for crypto, with a live order book and continuously priced volatility contracts.

MoveX Equities takes the same primitive to US stocks, on Solana, in the simplest possible form. No order book, no leverage, no margin. Pick a side, wait one session, collect.

Same thesis. Different asset class, and a much lower barrier to walk through the door.

---

**MoveX Equities. Trade magnitude, not direction.**
