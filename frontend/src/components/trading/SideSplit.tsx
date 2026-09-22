"use client";

// =============================================================================
// Side split
// =============================================================================
//
// The two answers of a market as the crowd currently prices them: one panel
// per answer with its implied chance and what it pays, and a bar showing how
// the pot is divided. Used on the board, on the market page and in the
// ladder, so every place reads the same numbers the same way.

import { fmtChance, fmtMultiple, fmtUsdx } from "@/lib/format";
import {
  SIDE_META,
  payoutMultiple,
  poolOf,
  poolShare,
  pot,
  type MarketView,
  type Side,
} from "@/lib/market";
import { cn } from "@/lib/utils";

export const SIDE_TEXT: Record<Side, string> = { above: "text-above", below: "text-below" };
const SIDE_FILL: Record<Side, string> = { above: "bg-above", below: "bg-below" };

/** Resting and hover treatment per side, so a card hints at being clickable. */
const SIDE_PANEL: Record<Side, string> = {
  above: "border-above/25 bg-above/[0.06] group-hover:border-above/45 group-hover:bg-above/[0.1]",
  below: "border-below/25 bg-below/[0.06] group-hover:border-below/45 group-hover:bg-below/[0.1]",
};

type ChipState = "normal" | "winner" | "loser";

const SIZE = {
  sm: { pad: "px-2.5 py-2", label: "text-[11.5px]", pct: "text-[16px]", meta: "text-[11px]" },
  md: { pad: "px-3 py-2.5", label: "text-[12.5px]", pct: "text-[21px]", meta: "text-[11.5px]" },
  lg: { pad: "px-4 py-3.5", label: "text-[14px]", pct: "text-[28px]", meta: "text-[12.5px]" },
} as const;

export function SideChip({
  side,
  chance,
  pays,
  amount,
  size = "md",
  state = "normal",
  className,
}: {
  side: Side;
  /** Pool share, 0..1. Null when the market holds nothing yet. */
  chance: number | null;
  pays: number | null;
  amount?: bigint;
  size?: keyof typeof SIZE;
  state?: ChipState;
  className?: string;
}) {
  const meta = SIDE_META[side];
  const s = SIZE[size];
  const dim = state === "loser";

  return (
    <div
      className={cn(
        "min-w-0 rounded-md border transition-colors duration-200",
        s.pad,
        dim ? "border-line-1 bg-transparent" : SIDE_PANEL[side],
        state === "winner" && "ring-1 ring-inset",
        state === "winner" && (side === "above" ? "ring-above/40" : "ring-below/40"),
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-semibold tracking-[0.05em]",
            s.label,
            dim ? "text-text-3" : SIDE_TEXT[side],
          )}
        >
          {meta.label}
        </span>
        <span
          className={cn(
            "font-mono font-semibold tabular leading-none tracking-tight",
            s.pct,
            dim ? "text-text-3" : "text-text-1",
          )}
        >
          {chance === null ? "--" : fmtChance(chance)}
        </span>
      </div>
      <div
        className={cn(
          "mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono tabular text-text-3",
          s.meta,
        )}
      >
        <span className="whitespace-nowrap">
          {/* The losing side never pays, so it quotes no multiple. */}
          {state === "loser" ? (
            "no payout"
          ) : (
            <>
              {state === "winner" ? "paid " : "pays "}
              <span className="text-text-1">{fmtMultiple(pays)}</span>
            </>
          )}
        </span>
        {amount !== undefined && (
          <span className="whitespace-nowrap">{fmtUsdx(amount, { compact: true })}</span>
        )}
      </div>
    </div>
  );
}

export function SplitBar({
  market,
  size = "md",
  highlight,
  className,
}: {
  market: MarketView;
  size?: "sm" | "md";
  highlight?: Side | null;
  className?: string;
}) {
  const total = pot(market);
  const share = total === 0n ? 0.5 : poolShare(market, "above");
  return (
    <div
      className={cn(
        "flex w-full gap-[3px] overflow-hidden rounded-full",
        size === "sm" ? "h-1" : "h-1.5",
        className,
      )}
      role="img"
      aria-label={
        total === 0n ? "No deposits yet" : `YES ${fmtChance(share)}, NO ${fmtChance(1 - share)}`
      }
    >
      {total === 0n ? (
        <div className="h-full w-full rounded-full bg-white/[0.06]" />
      ) : (
        <>
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              highlight === "below" ? "bg-above/25" : SIDE_FILL.above,
            )}
            style={{ width: `calc(${share * 100}% - 1.5px)` }}
          />
          <div
            className={cn(
              "h-full flex-1 rounded-full transition-[width] duration-500",
              highlight === "above" ? "bg-below/25" : SIDE_FILL.below,
            )}
          />
        </>
      )}
    </div>
  );
}

export default function SideSplit({
  market,
  size = "md",
  chips = true,
  amounts = true,
  highlight,
  className,
}: {
  market: MarketView;
  size?: keyof typeof SIZE;
  chips?: boolean;
  amounts?: boolean;
  /** The winning answer once settled; the other panel goes quiet. */
  highlight?: Side | null;
  className?: string;
}) {
  const total = pot(market);
  const empty = total === 0n;
  const chance = (side: Side) => (empty ? null : poolShare(market, side));
  const stateOf = (side: Side): ChipState =>
    highlight ? (highlight === side ? "winner" : "loser") : "normal";

  return (
    <div className={cn("min-w-0", className)}>
      {chips && (
        <div className="grid grid-cols-2 gap-2">
          {(["above", "below"] as Side[]).map((side) => (
            <SideChip
              key={side}
              side={side}
              chance={chance(side)}
              pays={payoutMultiple(market, side)}
              amount={amounts ? poolOf(market, side) : undefined}
              size={size}
              state={stateOf(side)}
            />
          ))}
        </div>
      )}
      <SplitBar
        market={market}
        size={size === "sm" ? "sm" : "md"}
        highlight={highlight}
        className={chips ? "mt-2.5" : undefined}
      />
      {empty && !chips && <p className="mt-1.5 text-[11.5px] text-text-3">No deposits yet</p>}
    </div>
  );
}
