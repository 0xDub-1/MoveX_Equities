"use client";

// =============================================================================
// Withdraw modal
// =============================================================================
//
// Takes part or all of a stake back out of a market that has not locked.
// The parent owns the transaction hook so the row and the modal share one
// pending state; this component only validates and asks.

import { useState } from "react";

import { venueOfSymbol } from "@/lib/assets";
import { fmtDateTime } from "@/lib/clock";
import { QUOTE_DECIMALS } from "@/lib/config";
import { fmtUsdx, toBase } from "@/lib/format";
import { isDepositable, type MarketView, type Side } from "@/lib/market";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Button, Eyebrow, SideTag, Stat } from "@/components/ui/primitives";

import { marketTitle, windowLabel, type PositionRow } from "./rows";

const QUICK_PCTS = [25, 50, 75, 100] as const;

/** Base units as the plain decimal the input holds: `1250000n` is `1.25`. */
function baseToInput(base: bigint): string {
  const unit = 10n ** BigInt(QUOTE_DECIMALS);
  const whole = base / unit;
  const frac = (base % unit).toString().padStart(QUOTE_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function pctOf(amount: bigint, pct: number): bigint {
  return (amount * BigInt(pct)) / 100n;
}

export default function WithdrawModal({
  open,
  row,
  now,
  pending,
  onClose,
  onWithdraw,
}: {
  open: boolean;
  row: PositionRow | null;
  now: number;
  pending: boolean;
  onClose: () => void;
  onWithdraw: (market: MarketView, side: Side, amount: bigint) => Promise<string | null>;
}) {
  const [text, setText] = useState("");

  const stake = row?.position.amount ?? 0n;
  const amount = toBase(text);
  const locked = row !== null && now > 0 && !isDepositable(row.market, now);
  const valid = amount !== null && amount > 0n && amount <= stake;

  let hint: string | null = null;
  if (text.trim() !== "") {
    if (amount === null) hint = "Enter a plain decimal amount.";
    else if (amount === 0n) hint = "Enter an amount above zero.";
    else if (amount > stake) hint = "That is more than your stake.";
  }

  const close = () => {
    setText("");
    onClose();
  };

  const submit = async () => {
    if (!row || amount === null || !valid) return;
    const signature = await onWithdraw(row.market, row.position.side, amount);
    if (signature) close();
  };

  const busy = pending || locked;

  return (
    <Modal
      open={open && row !== null}
      onClose={close}
      title="Withdraw"
      subtitle={row ? `${marketTitle(row.market)} · ${windowLabel(row.market)}` : undefined}
    >
      {row && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 rounded-md border border-line-1 bg-surface-0/60 px-3.5 py-3">
            <Stat label="Your answer" value={<SideTag side={row.position.side} />} />
            <Stat label="Staked" value={`${fmtUsdx(stake)} USDX`} align="right" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="withdraw-amount">
              <Eyebrow size="sm">Amount to withdraw</Eyebrow>
            </label>
            <div className="relative">
              <input
                id="withdraw-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="0.00"
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                className={cn(
                  "h-11 w-full rounded-md border border-line-2 bg-surface-0 px-3 pr-16 font-mono text-[15px] tabular text-text-1",
                  "placeholder:text-text-4 focus:border-line-3 focus:outline-none disabled:opacity-40",
                  hint && "border-loss/40 focus:border-loss/60",
                )}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[11px] tracking-[0.14em] text-text-3">
                USDX
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_PCTS.map((pct) => {
                const target = pctOf(stake, pct);
                const selected = stake > 0n && amount !== null && amount === target;
                return (
                  <button
                    key={pct}
                    type="button"
                    disabled={busy || stake === 0n}
                    onClick={() => setText(baseToInput(target))}
                    className={cn(
                      "h-8 rounded border border-line-2 bg-white/[0.02] font-mono text-[11px] tabular text-text-2 transition-colors",
                      "hover:bg-white/[0.06] hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40",
                      selected && "border-line-3 bg-white/[0.06] text-text-1",
                    )}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
            {hint && <p className="text-[12px] text-loss">{hint}</p>}
          </div>

          <Button
            variant="primary"
            block
            loading={pending}
            disabled={!valid || locked}
            onClick={() => void submit()}
          >
            Withdraw
          </Button>

          <p className="text-[11.5px] leading-relaxed text-text-3">
            {locked
              ? "This market has locked. Withdrawals are closed and the stake rides to settlement."
              : `Withdrawals are open until the market locks at ${fmtDateTime(row.market.lockTs, venueOfSymbol(row.market.symbol))}.`}
          </p>
        </div>
      )}
    </Modal>
  );
}
