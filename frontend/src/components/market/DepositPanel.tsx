"use client";

// =============================================================================
// Trade panel
// =============================================================================
//
// What the connected wallet can do with this market right now, which depends
// on the phase: deposit or withdraw while open, deposit under a cap while
// live, claim once settled or voided. Amounts stay in base units until the
// moment they are displayed; nothing that goes on chain passes through a
// float.
//
// A wallet may hold one position per side, so everything below takes the
// positions as a pair and renders whichever exist.

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { fmtEtDateTime, fmtEtTime } from "@/lib/calendar";
import { MIN_DEPOSIT_BASE, QUOTE_SYMBOL, SOL_FAUCET_URL, VOID_GRACE_SECS } from "@/lib/config";
import {
  fmtAgo,
  fmtBps,
  fmtChance,
  fmtCountdown,
  fmtMultiple,
  fmtPct,
  fmtUsdx,
  fmtUsdxSigned,
  toBase,
} from "@/lib/format";
import {
  SIDE_META,
  claimAmount,
  claimValue,
  liveDepositsOpen,
  liveMultipleBps,
  moveBps,
  payoutMultiple,
  poolOf,
  poolShare,
  pot,
  projectedPayout,
  sideAt,
  type MarketPhase,
  type MarketView,
  type PositionView,
  type PriceFeedView,
  type Side,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { useBalances, type Balances } from "@/hooks/useBalances";
import { useMarketActions } from "@/hooks/useMarketActions";
import { usePosition, type Held } from "@/hooks/usePositions";
import { useProgram } from "@/hooks/useProgram";
import { Button, Countdown, Eyebrow, InlineLink, SideTag, Skeleton, Stat } from "@/components/ui/primitives";
import WalletButton from "@/components/ui/WalletButton";
import MoveMeter from "@/components/trading/MoveMeter";

import { baseToInput, feeLabel } from "./helpers";

type Actions = ReturnType<typeof useMarketActions>;

const SIDES: readonly Side[] = ["above", "below"];

const INPUT_SHELL =
  "flex items-center rounded-md border bg-surface-0/60 transition-colors focus-within:border-line-3";
const INPUT =
  "h-full min-w-0 flex-1 bg-transparent font-mono tabular text-text-1 outline-none placeholder:text-text-4";

/** The positions a wallet holds on a market, in side order. */
function heldList(held: Held): PositionView[] {
  return SIDES.flatMap((s) => (held[s] ? [held[s]!] : []));
}

function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[13px] leading-relaxed text-text-2", className)}>{children}</p>;
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-3">{label}</dt>
      <dd className={cn("text-right text-text-1", valueClassName)}>{value}</dd>
    </div>
  );
}

function BigAmount({ amount }: { amount: bigint }) {
  return (
    <p className="mt-2 font-display text-3xl font-semibold tabular tracking-tight text-text-1">
      {fmtUsdx(amount)}{" "}
      <span className="font-mono text-[12px] font-medium tracking-normal text-text-3">{QUOTE_SYMBOL}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 sm:px-5 py-5">
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-[78px]" />
        <Skeleton className="h-[78px]" />
      </div>
      <Skeleton className="h-12" />
      <Skeleton className="h-24" />
      <Skeleton className="h-12" />
    </div>
  );
}

function ConnectPrompt({ depositable }: { depositable: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>
        {depositable
          ? `Connect a wallet to answer YES or NO with ${QUOTE_SYMBOL}.`
          : "Connect a wallet to see or claim your position on this market."}
      </Note>
      <div className="[&>button]:w-full [&>button]:justify-center">
        <WalletButton size="lg" />
      </div>
      <p className="text-[11.5px] text-text-3">
        Devnet. You need a little SOL for fees and {QUOTE_SYMBOL} from the faucet.
      </p>
    </div>
  );
}

function PositionCard({
  market,
  position,
  phase,
}: {
  market: MarketView;
  position: PositionView;
  phase: MarketPhase;
}) {
  const clock = (() => {
    switch (phase) {
      case "deposits":
        return { label: "Locks in", value: <Countdown to={market.lockTs} /> };
      case "awaiting-lock":
        return { label: "Lock", value: "Awaiting" };
      case "live":
        return { label: "Settles in", value: <Countdown to={market.settleTs} /> };
      case "awaiting-settle":
        return { label: "Settle", value: "Awaiting" };
      default:
        return null;
    }
  })();

  const live = position.live;
  const preLock = position.amount - live.amount;
  // Money placed after lock is paid under its cap, so the pool multiple only
  // describes the part that was there before.
  const liveCap = live.amount > 0n ? Number(live.floor + live.excess) / Number(live.amount) : null;

  return (
    <div className="rounded-md border border-line-2 bg-white/[0.02] px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Your position</Eyebrow>
        <SideTag side={position.side} size="sm" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Stake" size="sm" value={fmtUsdx(position.amount)} sub={QUOTE_SYMBOL} valueClassName="font-mono" />
        {preLock > 0n ? (
          <Stat
            label="Pays"
            size="sm"
            value={fmtMultiple(payoutMultiple(market, position.side))}
            sub="if it wins"
            valueClassName="font-mono"
          />
        ) : (
          <Stat
            label="Pays at most"
            size="sm"
            value={fmtMultiple(liveCap)}
            sub="placed live"
            valueClassName="font-mono"
          />
        )}
        {clock && (
          <Stat label={clock.label} size="sm" value={clock.value} align="right" valueClassName="font-mono" />
        )}
      </div>
      {preLock > 0n && live.amount > 0n && (
        <p className="mt-2.5 font-mono text-[11px] tabular text-text-3">
          {fmtUsdx(live.amount)} {QUOTE_SYMBOL} of it was placed after lock and pays at most{" "}
          {fmtMultiple(liveCap)}.
        </p>
      )}
    </div>
  );
}

function DepositForm({
  market,
  balances,
  held,
  actions,
  now,
  live,
}: {
  market: MarketView;
  balances: Balances | undefined;
  held: Held;
  actions: Actions;
  now: number;
  /** Whether this deposit lands after lock, under the cap. */
  live: boolean;
}) {
  const [side, setSide] = useState<Side>("above");
  const [input, setInput] = useState("");

  const label = SIDE_META[side].label;
  const strike = fmtBps(market.strikeBps);

  const amount = toBase(input);
  const typed = input.trim() !== "";
  const noUsdx = balances !== undefined && (!balances.hasTokenAccount || balances.usdx === 0n);
  const noSol = balances !== undefined && balances.lamports === 0;

  let error: string | null = null;
  if (typed && amount === null) error = "Enter a plain number, like 25 or 12.5";
  else if (amount !== null && amount < MIN_DEPOSIT_BASE) error = `Minimum deposit is 1 ${QUOTE_SYMBOL}`;
  else if (amount !== null && balances !== undefined && amount > balances.usdx) error = "Exceeds your balance";

  const valid = amount !== null && error === null && balances !== undefined && !noUsdx && !noSol;
  const pending = actions.isPending(market, "deposit");

  const setPct = (pct: bigint) => {
    if (balances) setInput(baseToInput((balances.usdx * pct) / 100n));
  };

  const submit = async () => {
    if (!valid || amount === null) return;
    const signature = await actions.deposit(market, side, amount);
    if (signature) setInput("");
  };

  // The projection includes this deposit, so it already reflects the user's
  // own money landing on the side, and in the live round, its cap.
  const extra = amount !== null && amount > 0n ? amount : 0n;
  const sidePoolAfter = poolOf(market, side) + extra;
  const mineAfter = (held[side]?.amount ?? 0n) + extra;
  const share = sidePoolAfter > 0n ? (Number(mineAfter) / Number(sidePoolAfter)) * 100 : 0;
  const payout = extra > 0n ? projectedPayout(market, side, extra, now) : null;
  const profit = payout !== null ? payout - extra : null;

  const capBps = live ? liveMultipleBps(market, now) : null;
  const closesIn = live ? market.settleTs - market.liveCutoffSecs - now : null;

  // What a unit on each side pays if it wins. In the live round the pool
  // multiple is a ceiling the cap sits under, so the lower of the two is the
  // honest number to show on the selector.
  const sidePays = (s: Side): number | null => {
    const pool = payoutMultiple(market, s);
    if (!live || pool === null || capBps === null) return pool;
    return Math.min(pool, capBps / 10_000);
  };

  const total = pot(market);

  return (
    <div className="flex flex-col gap-5">
      {live && (
        <div className="rounded-md border border-below/30 bg-below/[0.06] px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Live round</Eyebrow>
            {closesIn !== null && (
              <span className="font-mono text-[11px] tabular text-text-3">
                closes in {fmtCountdown(closesIn)}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-2">
            The reference price is already set. A deposit now counts under a cap:{" "}
            <span className="font-mono tabular text-text-1">{fmtMultiple(capBps! / 10_000)}</span> at most
            right now, falling towards {fmtMultiple((10_000 - market.feeBps) / 10_000)} at settlement. Money
            placed before lock is never diluted by yours.
          </p>
        </div>
      )}

      <div>
        <p className="text-[14px] font-semibold leading-snug text-text-1">
          Will {market.symbol} move more than <span className="font-mono tabular">{strike}</span>?
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {SIDES.map((s) => {
            const selected = s === side;
            const chance = total > 0n ? poolShare(market, s) : null;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={selected}
                onClick={() => setSide(s)}
                className={cn(
                  "flex min-w-0 flex-col items-start rounded-md border px-3 py-3 text-left transition-colors",
                  selected && s === "above" && "border-above/70 bg-above/10",
                  selected && s === "below" && "border-below/70 bg-below/10",
                  !selected && "border-line-2 hover:border-line-3 hover:bg-white/[0.04]",
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-[14px] font-semibold tracking-[0.04em]",
                      s === "above" ? "text-above" : "text-below",
                      !selected && "opacity-80",
                    )}
                  >
                    {SIDE_META[s].label}
                  </span>
                  <span className="font-mono text-[18px] font-semibold tabular text-text-1">
                    {chance === null ? "--" : fmtChance(chance)}
                  </span>
                </span>
                <span className="mt-1 text-[12px] leading-snug text-text-2">
                  {s === "above" ? `Moves more than ${strike}` : `Stays within ${strike}`}
                </span>
                <span className="mt-1.5 font-mono text-[12px] tabular text-text-3">
                  pays <span className="text-text-1">{fmtMultiple(sidePays(s))}</span>
                </span>
              </button>
            );
          })}
        </div>
        {held[side] && (
          <p className="mt-2 text-[12px] text-text-3">
            You already hold {fmtUsdx(held[side]!.amount)} {QUOTE_SYMBOL} on {label}. This adds to it.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Amount</Eyebrow>
          <span className="font-mono text-[11px] tabular text-text-3">
            Balance {balances ? fmtUsdx(balances.usdx) : "--"} {QUOTE_SYMBOL}
            <button
              type="button"
              onClick={() => setPct(100n)}
              disabled={!balances}
              className="ml-2 text-brand underline-offset-2 hover:underline disabled:opacity-40"
            >
              Max
            </button>
          </span>
        </div>
        <div className={cn(INPUT_SHELL, "mt-2 h-12 px-3.5", error ? "border-loss/50" : "border-line-2")}>
          <input
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label={`Deposit amount in ${QUOTE_SYMBOL}`}
            aria-invalid={error !== null}
            className={cn(INPUT, "text-[16px]")}
          />
          <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            {QUOTE_SYMBOL}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[25n, 50n, 75n, 100n].map((pct) => (
            <Button
              key={pct.toString()}
              size="sm"
              variant="ghost"
              disabled={!balances}
              onClick={() => setPct(pct)}
              className="font-mono tabular"
            >
              {pct.toString()}%
            </Button>
          ))}
        </div>
        {error && <p className="mt-2 text-[11.5px] text-loss">{error}</p>}
        {noUsdx && (
          <p className="mt-2 text-[11.5px] text-text-3">
            No {QUOTE_SYMBOL} in this wallet.{" "}
            <InlineLink href="/">Draw {QUOTE_SYMBOL} from the faucet</InlineLink>
          </p>
        )}
        {noSol && (
          <p className="mt-2 text-[11.5px] text-text-3">
            No SOL for transaction fees.{" "}
            <InlineLink href={SOL_FAUCET_URL} external>
              Get devnet SOL
            </InlineLink>
          </p>
        )}
      </div>

      <dl className="flex flex-col gap-1.5 rounded-md border border-line-1 bg-white/[0.015] px-3.5 py-3 font-mono text-[12px] tabular">
        <Row label={`${label} pool after deposit`} value={`${fmtUsdx(sidePoolAfter)} ${QUOTE_SYMBOL}`} />
        {live ? (
          <Row label="Counts up to" value={fmtMultiple(capBps! / 10_000)} />
        ) : (
          <Row label={`Your share of ${label}`} value={fmtPct(share)} />
        )}
        <Row
          label={`Payout if ${label} wins`}
          value={payout !== null ? `${fmtUsdx(payout)} ${QUOTE_SYMBOL}` : "--"}
        />
        <Row
          label="Potential profit"
          value={profit !== null ? `${fmtUsdxSigned(profit)} ${QUOTE_SYMBOL}` : "--"}
          valueClassName={profit !== null ? (profit >= 0n ? "text-brand" : "text-loss") : undefined}
        />
      </dl>

      <Button block size="lg" variant={side} disabled={!valid} loading={pending} onClick={() => void submit()}>
        {amount !== null && amount > 0n
          ? `Deposit ${fmtUsdx(amount)} ${QUOTE_SYMBOL} on ${label}`
          : `Deposit on ${label}`}
      </Button>
    </div>
  );
}

function WithdrawForm({
  market,
  position,
  actions,
}: {
  market: MarketView;
  position: PositionView;
  actions: Actions;
}) {
  // Null means "the whole stake", which tracks the position as it changes.
  const [text, setText] = useState<string | null>(null);
  const value = text ?? baseToInput(position.amount);
  const amount = toBase(value);

  let error: string | null = null;
  if (value.trim() !== "" && amount === null) error = "Enter a plain number";
  else if (amount !== null && amount === 0n) error = "Enter an amount above zero";
  else if (amount !== null && amount > position.amount) error = "Exceeds your stake";

  const valid = amount !== null && amount > 0n && amount <= position.amount;
  const pending = actions.isPending(market, "withdraw");

  const submit = async () => {
    if (!valid || amount === null) return;
    const signature = await actions.withdraw(market, position.side, amount);
    if (signature) setText(null);
  };

  return (
    <div className="rounded-md border border-line-1 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Withdraw from {SIDE_META[position.side].label}</Eyebrow>
        <button
          type="button"
          onClick={() => setText(null)}
          className="font-mono text-[11px] text-brand underline-offset-2 hover:underline"
        >
          All
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <div className={cn(INPUT_SHELL, "h-10 min-w-0 flex-1 px-3", error ? "border-loss/50" : "border-line-2")}>
          <input
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            value={value}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Withdraw amount in ${QUOTE_SYMBOL}`}
            aria-invalid={error !== null}
            className={cn(INPUT, "text-[16px] sm:text-[13px]")}
          />
          <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            {QUOTE_SYMBOL}
          </span>
        </div>
        <Button variant="secondary" disabled={!valid} loading={pending} onClick={() => void submit()}>
          Withdraw
        </Button>
      </div>
      {error && <p className="mt-2 text-[11.5px] text-loss">{error}</p>}
      <p className="mt-2 text-[11px] text-text-3">Open until lock. Nothing can be withdrawn after it.</p>
    </div>
  );
}

function LiveBody({
  market,
  phase,
  held,
  feed,
  now,
  balances,
  actions,
}: {
  market: MarketView;
  phase: MarketPhase;
  held: Held;
  feed: PriceFeedView | undefined;
  now: number;
  balances: Balances | undefined;
  actions: Actions;
}) {
  const price = feed?.price;
  const lead = market.referencePrice > 0n && price !== undefined ? sideAt(market, price) : null;
  const positions = heldList(held);
  const open = phase === "live" && liveDepositsOpen(market, now);

  let sentence: string;
  if (!lead) {
    sentence = "Waiting for a live price.";
  } else if (positions.length === 2) {
    sentence = `You hold both answers. ${SIDE_META[lead].label} is winning right now.`;
  } else if (positions.length === 1) {
    sentence = lead === positions[0].side ? "Your answer is winning right now." : "Your answer is losing right now.";
  } else {
    sentence = `${SIDE_META[lead].label} is winning right now.`;
  }
  sentence +=
    phase === "awaiting-settle"
      ? " Settlement is waiting on the crank."
      : ` The market settles at ${fmtEtTime(market.settleTs)} ET.`;

  return (
    <div className="flex flex-col gap-4">
      {positions.map((p) => (
        <PositionCard key={p.key} market={market} position={p} phase={phase} />
      ))}

      <div className="rounded-md border border-line-1 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Standing</Eyebrow>
          {feed && (
            <span className="font-mono text-[11px] tabular text-text-4">{fmtAgo(now - feed.publishTime)}</span>
          )}
        </div>
        <MoveMeter className="mt-3" reference={market.referencePrice} current={price} strikeBps={market.strikeBps} />
        <p
          className={cn(
            "mt-2.5 text-[12.5px] leading-relaxed",
            positions.length === 1 && lead && lead === positions[0].side ? "text-text-1" : "text-text-2",
          )}
        >
          {sentence}
        </p>
      </div>

      {open ? (
        <DepositForm market={market} balances={balances} held={held} actions={actions} now={now} live />
      ) : phase === "live" ? (
        <Note>
          {market.liveDeposits
            ? `Live deposits closed ${fmtCountdown(market.liveCutoffSecs)} before settlement.`
            : "Deposits closed at lock on this market."}
        </Note>
      ) : null}
    </div>
  );
}

function SettledBody({
  market,
  held,
  actions,
}: {
  market: MarketView;
  held: Held;
  actions: Actions;
}) {
  const winner = market.winningSide;
  const pending = actions.isPending(market, "claim");
  const bps = moveBps(market.referencePrice, market.settlementPrice);
  const outcome = `${market.symbol} moved ${fmtBps(bps)}, ${bps > market.strikeBps ? "past" : "within"} the ${fmtBps(market.strikeBps)} threshold.`;
  const positions = heldList(held);

  if (!winner) return <Note>Settled.</Note>;

  if (positions.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] text-text-1">Settled. {SIDE_META[winner].label} won.</p>
        <Note>{outcome}</Note>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {positions.map((p) => {
        if (p.side !== winner) {
          return (
            <div key={p.key} className="rounded-md border border-line-2 px-4 py-4">
              <Note>
                You answered {SIDE_META[p.side].label}. {SIDE_META[winner].label} won.
              </Note>
              <div className="mt-3 flex items-center justify-between font-mono text-[12px] tabular">
                <span className="text-text-3">Stake</span>
                <span className="text-loss">
                  {fmtUsdxSigned(-p.amount)} {QUOTE_SYMBOL}
                </span>
              </div>
            </div>
          );
        }

        const payout = p.claimed ? claimValue(market, p) : claimAmount(market, p);
        const profit = payout - p.amount;

        if (p.claimed) {
          return (
            <div key={p.key} className="rounded-md border border-line-2 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>Claimed</Eyebrow>
                <SideTag side={winner} size="sm" />
              </div>
              <BigAmount amount={payout} />
              <p className="mt-1.5 text-[11.5px] text-text-3">
                Collected to your wallet. Stake {fmtUsdx(p.amount)} {QUOTE_SYMBOL}, profit{" "}
                {fmtUsdxSigned(profit)} {QUOTE_SYMBOL}.
              </p>
            </div>
          );
        }

        return (
          <div
            key={p.key}
            className={cn(
              "rounded-md border px-4 py-4",
              winner === "above" ? "border-above/40 bg-above/[0.06]" : "border-below/40 bg-below/[0.06]",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold uppercase tracking-[0.16em]",
                  winner === "above" ? "text-above" : "text-below",
                )}
              >
                You won
              </span>
              <SideTag side={winner} size="sm" />
            </div>
            <BigAmount amount={payout} />
            <p className="mt-1.5 text-[11.5px] text-text-3">
              Stake {fmtUsdx(p.amount)} {QUOTE_SYMBOL}, profit{" "}
              <span className={profit >= 0n ? "text-brand" : "text-loss"}>{fmtUsdxSigned(profit)}</span>{" "}
              {QUOTE_SYMBOL}.
            </p>
            <Button
              className="mt-4"
              variant="primary"
              block
              size="lg"
              loading={pending}
              onClick={() => void actions.claim(market, p.side, payout)}
            >
              Claim {fmtUsdx(payout)} {QUOTE_SYMBOL}
            </Button>
          </div>
        );
      })}
      <p className="text-[11.5px] text-text-3">{outcome}</p>
    </div>
  );
}

/**
 * A market that missed its moment by too much to resolve.
 *
 * Nothing can be done here yet: the refund only opens once the market is far
 * enough past its settle time for anyone to void it. So this says what
 * happened, what is owed, and when.
 */
function ExpiredBody({ market, held }: { market: MarketView; held: Held }) {
  const refundAt = market.settleTs + VOID_GRACE_SECS;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-loss/25 bg-loss/[0.05] px-4 py-3.5">
        <Eyebrow>Could not resolve</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-text-2">
          No price arrived close enough to{" "}
          {market.state === "open" ? "the lock" : "the settlement"} for this market to use the
          number it was sold on. Every deposit is refunded in full, with no fee taken.
        </p>
      </div>

      {heldList(held).map((p) => (
        <div key={p.key} className="rounded-md border border-line-2 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Your refund</Eyebrow>
            <SideTag side={p.side} size="sm" muted />
          </div>
          <BigAmount amount={p.amount} />
        </div>
      ))}

      <div className="flex items-baseline justify-between gap-3 rounded-md border border-line-1 px-4 py-3 font-mono text-[12px] tabular">
        <span className="text-text-3">Refund opens</span>
        <span className="text-right text-text-1">
          <Countdown to={refundAt} done="now" />
          <span className="text-text-3"> · {fmtEtDateTime(refundAt)}</span>
        </span>
      </div>
    </div>
  );
}

function VoidedBody({
  market,
  held,
  actions,
}: {
  market: MarketView;
  held: Held;
  actions: Actions;
}) {
  const pending = actions.isPending(market, "claim");
  return (
    <div className="flex flex-col gap-4">
      <Note>This market was voided. Deposits are refunded in full.</Note>
      {heldList(held).map((p) =>
        p.claimed ? (
          <div
            key={p.key}
            className="flex items-center justify-between rounded-md border border-line-1 px-4 py-3 font-mono text-[12px] tabular"
          >
            <span className="text-text-3">Refunded, {SIDE_META[p.side].label}</span>
            <span className="text-text-1">
              {fmtUsdx(p.amount)} {QUOTE_SYMBOL}
            </span>
          </div>
        ) : (
          <div key={p.key} className="rounded-md border border-line-2 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Refund</Eyebrow>
              <SideTag side={p.side} size="sm" muted />
            </div>
            <BigAmount amount={p.amount} />
            <Button
              className="mt-4"
              variant="primary"
              block
              size="lg"
              loading={pending}
              onClick={() => void actions.claim(market, p.side, p.amount)}
            >
              Claim refund
            </Button>
          </div>
        ),
      )}
    </div>
  );
}

function FooterRows({ feeBps }: { feeBps: number }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line-1 px-4 sm:px-5 py-3 font-mono text-[10.5px] tabular text-text-3">
      <div className="flex items-baseline justify-between gap-3">
        <span>Fee</span>
        <span className="text-right">{feeLabel(feeBps)} of the pot, paid by the winning side</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span>Min deposit</span>
        <span>
          {fmtUsdx(MIN_DEPOSIT_BASE, { decimals: 0 })} {QUOTE_SYMBOL}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function DepositPanel({
  market,
  phase,
  now,
  feed,
}: {
  market: MarketView | undefined;
  phase: MarketPhase | undefined;
  /** Unix seconds; zero before mount. */
  now: number;
  feed: PriceFeedView | undefined;
}) {
  const { publicKey, connected } = useProgram();
  const { held } = usePosition(market?.key, publicKey);
  const { data: balances } = useBalances(publicKey);
  const actions = useMarketActions();

  if (!market || !phase || now === 0) return <PanelSkeleton />;

  const ready = connected && publicKey !== null;
  const positions = heldList(held);

  let body: ReactNode;
  if (!ready) {
    body = (
      <ConnectPrompt
        depositable={phase === "deposits" || (phase === "live" && liveDepositsOpen(market, now))}
      />
    );
  } else {
    switch (phase) {
      case "deposits":
        body = (
          <div className="flex flex-col gap-5">
            <DepositForm market={market} balances={balances} held={held} actions={actions} now={now} live={false} />
            {positions.map((p) => (
              <div key={p.key} className="flex flex-col gap-3">
                <PositionCard market={market} position={p} phase={phase} />
                <WithdrawForm market={market} position={p} actions={actions} />
              </div>
            ))}
          </div>
        );
        break;
      case "awaiting-lock":
        body = (
          <div className="flex flex-col gap-4">
            <Note>Deposits paused. Waiting for the crank to record the reference price.</Note>
            {positions.map((p) => (
              <PositionCard key={p.key} market={market} position={p} phase={phase} />
            ))}
          </div>
        );
        break;
      case "live":
      case "awaiting-settle":
        body = (
          <LiveBody
            market={market}
            phase={phase}
            held={held}
            feed={feed}
            now={now}
            balances={balances}
            actions={actions}
          />
        );
        break;
      case "expired":
        body = <ExpiredBody market={market} held={held} />;
        break;
      case "settled":
        body = <SettledBody market={market} held={held} actions={actions} />;
        break;
      case "voided":
        body = <VoidedBody market={market} held={held} actions={actions} />;
        break;
    }
  }

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${ready ? "wallet" : "guest"}:${phase}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="px-4 sm:px-5 py-5"
        >
          {body}
        </motion.div>
      </AnimatePresence>
      <FooterRows feeBps={market.feeBps} />
    </div>
  );
}
