"use client";

// =============================================================================
// Trade panel
// =============================================================================
//
// What the connected wallet can do with this market right now, which depends
// on the phase: deposit or withdraw while open, watch while live, claim once
// settled or voided. Amounts stay in base units until the moment they are
// displayed; nothing that goes on chain passes through a float.

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { fmtEtTime } from "@/lib/calendar";
import { MIN_DEPOSIT_BASE, QUOTE_SYMBOL, SOL_FAUCET_URL } from "@/lib/config";
import {
  fmtAgo,
  fmtBps,
  fmtChance,
  fmtMultiple,
  fmtPct,
  fmtUsdx,
  fmtUsdxSigned,
  toBase,
} from "@/lib/format";
import {
  SIDE_META,
  claimAmount,
  distributable,
  moveBps,
  payoutMultiple,
  poolOf,
  poolShare,
  pot,
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
import { usePosition } from "@/hooks/usePositions";
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

/** What a winning position was paid, whether or not it has been claimed yet. */
function settledPayout(market: MarketView, position: PositionView): bigint {
  if (!market.winningSide) return 0n;
  const winningPool = poolOf(market, market.winningSide);
  if (winningPool === 0n) return 0n;
  return (position.amount * distributable(pot(market), market.feeBps)) / winningPool;
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

  return (
    <div className="rounded-md border border-line-2 bg-white/[0.02] px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Your position</Eyebrow>
        <SideTag side={position.side} size="sm" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Stake" size="sm" value={fmtUsdx(position.amount)} sub={QUOTE_SYMBOL} valueClassName="font-mono" />
        <Stat
          label="Pays"
          size="sm"
          value={fmtMultiple(payoutMultiple(market, position.side))}
          sub="if it wins"
          valueClassName="font-mono"
        />
        {clock && (
          <Stat label={clock.label} size="sm" value={clock.value} align="right" valueClassName="font-mono" />
        )}
      </div>
    </div>
  );
}

function DepositForm({
  market,
  balances,
  held,
  actions,
}: {
  market: MarketView;
  balances: Balances | undefined;
  held: PositionView | undefined;
  actions: Actions;
}) {
  const [chosen, setChosen] = useState<Side>("above");
  const [input, setInput] = useState("");

  // One side per market: an open position pins the selector to its side.
  const locked = held?.side;
  const side: Side = locked ?? chosen;
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

  // The projection includes this deposit, so the multiple already reflects
  // the user's own money landing on the side.
  const extra = amount !== null && amount > 0n ? amount : 0n;
  const sidePoolAfter = poolOf(market, side) + extra;
  const mineAfter = (held && held.side === side ? held.amount : 0n) + extra;
  const share = sidePoolAfter > 0n ? (Number(mineAfter) / Number(sidePoolAfter)) * 100 : 0;
  const multiple = payoutMultiple(market, side, extra);
  const payout = extra > 0n && multiple !== null ? BigInt(Math.floor(Number(extra) * multiple)) : null;
  const profit = payout !== null ? payout - extra : null;

  const total = pot(market);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[14px] font-semibold leading-snug text-text-1">
          Will {market.symbol} move more than <span className="font-mono tabular">{strike}</span>?
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {SIDES.map((s) => {
            const selected = s === side;
            const disabled = locked !== undefined && s !== locked;
            const chance = total > 0n ? poolShare(market, s) : null;
            return (
              <button
                key={s}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => setChosen(s)}
                className={cn(
                  "flex min-w-0 flex-col items-start rounded-md border px-3 py-3 text-left transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-40",
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
                  pays <span className="text-text-1">{fmtMultiple(payoutMultiple(market, s))}</span>
                </span>
              </button>
            );
          })}
        </div>
        {locked && (
          <p className="mt-2 text-[12px] text-text-3">
            Your position is on {SIDE_META[locked].label}. Withdraw it fully to switch answers.
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
        <Row label={`Your share of ${label}`} value={fmtPct(share)} />
        <Row
          label={`Payout if ${label} wins`}
          value={payout !== null ? `${fmtUsdx(payout)} ${QUOTE_SYMBOL}` : "--"}
        />
        <Row
          label="Potential profit"
          value={profit !== null ? `${fmtUsdxSigned(profit)} ${QUOTE_SYMBOL}` : "--"}
          valueClassName={profit !== null ? "text-brand" : undefined}
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
    const signature = await actions.withdraw(market, amount);
    if (signature) setText(null);
  };

  return (
    <div className="rounded-md border border-line-1 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Withdraw</Eyebrow>
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
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
            {QUOTE_SYMBOL}
          </span>
        </div>
        <Button variant="secondary" disabled={!valid} loading={pending} onClick={() => void submit()}>
          Withdraw
        </Button>
      </div>
      {error && <p className="mt-2 text-[11.5px] text-loss">{error}</p>}
      <p className="mt-2 text-[11px] text-text-3">
        Open until lock. A full withdrawal frees you to switch sides.
      </p>
    </div>
  );
}

function LiveBody({
  market,
  phase,
  held,
  feed,
  now,
}: {
  market: MarketView;
  phase: MarketPhase;
  held: PositionView | undefined;
  feed: PriceFeedView | undefined;
  now: number;
}) {
  const price = feed?.price;
  const lead = market.referencePrice > 0n && price !== undefined ? sideAt(market, price) : null;

  let sentence: string;
  if (!lead) {
    sentence = "Waiting for a live price.";
  } else if (held) {
    sentence = lead === held.side ? "Your answer is winning right now." : "Your answer is losing right now.";
  } else {
    sentence = `${SIDE_META[lead].label} is winning right now.`;
  }
  sentence +=
    phase === "awaiting-settle"
      ? " Settlement is waiting on the crank."
      : ` The market settles at ${fmtEtTime(market.settleTs)} ET.`;

  return (
    <div className="flex flex-col gap-4">
      {held ? (
        <PositionCard market={market} position={held} phase={phase} />
      ) : (
        <Note>You have no position in this market. Deposits closed at lock.</Note>
      )}
      <div className="rounded-md border border-line-1 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Standing</Eyebrow>
          {feed && (
            <span className="font-mono text-[10px] tabular text-text-4">{fmtAgo(now - feed.publishTime)}</span>
          )}
        </div>
        <MoveMeter className="mt-3" reference={market.referencePrice} current={price} strikeBps={market.strikeBps} />
        <p
          className={cn(
            "mt-2.5 text-[12.5px] leading-relaxed",
            held && lead && lead === held.side ? "text-text-1" : "text-text-2",
          )}
        >
          {sentence}
        </p>
      </div>
    </div>
  );
}

function SettledBody({
  market,
  held,
  actions,
}: {
  market: MarketView;
  held: PositionView | undefined;
  actions: Actions;
}) {
  const winner = market.winningSide;
  const pending = actions.isPending(market, "claim");
  const bps = moveBps(market.referencePrice, market.settlementPrice);
  const outcome = `${market.symbol} moved ${fmtBps(bps)}, ${bps > market.strikeBps ? "past" : "within"} the ${fmtBps(market.strikeBps)} threshold.`;

  if (!winner) return <Note>Settled.</Note>;

  if (!held) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] text-text-1">Settled. {SIDE_META[winner].label} won.</p>
        <Note>{outcome}</Note>
      </div>
    );
  }

  if (held.side !== winner) {
    return (
      <div className="rounded-md border border-line-2 px-4 py-4">
        <Note>
          You answered {SIDE_META[held.side].label}. {SIDE_META[winner].label} won.
        </Note>
        <div className="mt-3 flex items-center justify-between font-mono text-[12px] tabular">
          <span className="text-text-3">Stake</span>
          <span className="text-loss">
            {fmtUsdxSigned(-held.amount)} {QUOTE_SYMBOL}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] text-text-3">{outcome}</p>
      </div>
    );
  }

  const payout = held.claimed ? settledPayout(market, held) : claimAmount(market, held);
  const profit = payout - held.amount;

  if (held.claimed) {
    return (
      <div className="rounded-md border border-line-2 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Claimed</Eyebrow>
          <SideTag side={winner} size="sm" />
        </div>
        <BigAmount amount={payout} />
        <p className="mt-1.5 text-[11.5px] text-text-3">
          Collected to your wallet. Stake {fmtUsdx(held.amount)} {QUOTE_SYMBOL}, profit {fmtUsdxSigned(profit)}{" "}
          {QUOTE_SYMBOL}.
        </p>
      </div>
    );
  }

  return (
    <div
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
        Stake {fmtUsdx(held.amount)} {QUOTE_SYMBOL}, profit{" "}
        <span className="text-brand">{fmtUsdxSigned(profit)}</span> {QUOTE_SYMBOL}.
      </p>
      <Button
        className="mt-4"
        variant="primary"
        block
        size="lg"
        loading={pending}
        onClick={() => void actions.claim(market, payout)}
      >
        Claim {fmtUsdx(payout)} {QUOTE_SYMBOL}
      </Button>
    </div>
  );
}

function VoidedBody({
  market,
  held,
  actions,
}: {
  market: MarketView;
  held: PositionView | undefined;
  actions: Actions;
}) {
  const pending = actions.isPending(market, "claim");
  return (
    <div className="flex flex-col gap-4">
      <Note>This market was voided. Deposits are refunded in full.</Note>
      {held && !held.claimed && (
        <div className="rounded-md border border-line-2 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Refund</Eyebrow>
            <SideTag side={held.side} size="sm" muted />
          </div>
          <BigAmount amount={held.amount} />
          <Button
            className="mt-4"
            variant="primary"
            block
            size="lg"
            loading={pending}
            onClick={() => void actions.claim(market, held.amount)}
          >
            Claim refund
          </Button>
        </div>
      )}
      {held && held.claimed && (
        <div className="flex items-center justify-between rounded-md border border-line-1 px-4 py-3 font-mono text-[12px] tabular">
          <span className="text-text-3">Refunded</span>
          <span className="text-text-1">
            {fmtUsdx(held.amount)} {QUOTE_SYMBOL}
          </span>
        </div>
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
  const { position } = usePosition(market?.key, publicKey);
  const { data: balances } = useBalances(publicKey);
  const actions = useMarketActions();

  if (!market || !phase || now === 0) return <PanelSkeleton />;

  // A fully withdrawn position stays on chain with a zero stake; it is no
  // position for our purposes and no longer pins the side.
  const held = position && position.amount > 0n ? position : undefined;
  const ready = connected && publicKey !== null;

  let body: ReactNode;
  if (!ready) {
    body = <ConnectPrompt depositable={phase === "deposits"} />;
  } else {
    switch (phase) {
      case "deposits":
        body = (
          <div className="flex flex-col gap-5">
            <DepositForm market={market} balances={balances} held={held} actions={actions} />
            {held && (
              <div className="flex flex-col gap-3">
                <PositionCard market={market} position={held} phase={phase} />
                <WithdrawForm market={market} position={held} actions={actions} />
              </div>
            )}
          </div>
        );
        break;
      case "awaiting-lock":
        body = (
          <div className="flex flex-col gap-4">
            <Note>Deposits closed. Waiting for the crank to record the reference price.</Note>
            {held && <PositionCard market={market} position={held} phase={phase} />}
          </div>
        );
        break;
      case "live":
      case "awaiting-settle":
        body = <LiveBody market={market} phase={phase} held={held} feed={feed} now={now} />;
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
