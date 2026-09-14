"use client";

// =============================================================================
// Side split
// =============================================================================
//
// The two sides of a market as the crowd currently prices them: one chip
// per side with its implied chance and what it pays, and a bar showing how
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
const SIDE_BORDER: Record<Side, string> = { above: "border-above/40", below: "border-below/40" };
const SIDE_SOFT: Record<Side, string> = { above: "bg-above/[0.08]", below: "bg-below/[0.08]" };

type ChipState = "normal" | "winner" | "loser";

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
  size?: "sm" | "md" | "lg";
  state?: ChipState;
  className?: string;
}) {
  const meta = SIDE_META[side];
  const dim = state === "loser";
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border",
        size === "sm" && "px-2.5 py-2",
        size === "md" && "px-3 py-2.5",
        size === "lg" && "px-4 py-3.5",
        dim ? "border-line-1" : cn(SIDE_BORDER[side], SIDE_SOFT[side]),
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-semibold tracking-[0.06em]",
            size === "sm" ? "text-[11.5px]" : size === "lg" ? "text-[14px]" : "text-[12.5px]",
            dim ? "text-text-3" : SIDE_TEXT[side],
          )}
        >
          {meta.label}
          {state === "winner" && <span className="ml-1.5 font-medium text-text-2">won</span>}
        </span>
        <span
          className={cn(
            "font-mono font-semibold tabular",
            size === "sm" ? "text-[15px]" : size === "lg" ? "text-[26px]" : "text-[20px]",
            dim ? "text-text-3" : "text-text-1",
          )}
        >
          {chance === null ? "--" : fmtChance(chance)}
        </span>
      </div>
      <div
        className={cn(
          "mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono tabular text-text-3",
          size === "sm" ? "text-[11px]" : size === "lg" ? "text-[12.5px]" : "text-[11.5px]",
        )}
      >
        <span className="whitespace-nowrap">
          pays <span className={dim ? "text-text-3" : "text-text-2"}>{fmtMultiple(pays)}</span>
        </span>
        {amount !== undefined && (
          <span className="whitespace-nowrap">{fmtUsdx(amount, { compact: true })} USDX</span>
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
        "flex w-full overflow-hidden rounded-full bg-white/[0.06]",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
      role="img"
      aria-label={
        total === 0n
          ? "No deposits yet"
          : `YES ${fmtChance(share)}, NO ${fmtChance(1 - share)}`
      }
    >
      {total === 0n ? (
        <div className="h-full w-full bg-white/[0.04]" />
      ) : (
        <>
          <div
            className={cn(
              "h-full transition-[width] duration-500",
              highlight === "below" ? "bg-above/30" : SIDE_FILL.above,
            )}
            style={{ width: `${share * 100}%` }}
          />
          <div
            className={cn(
              "h-full flex-1 transition-[width] duration-500",
              highlight === "above" ? "bg-below/30" : SIDE_FILL.below,
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
  size?: "sm" | "md" | "lg";
  chips?: boolean;
  amounts?: boolean;
  /** The winning side once settled; the other chip goes quiet. */
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
        className={chips ? "mt-2" : undefined}
      />
      {empty && !chips && (
        <p className="mt-1.5 text-[11.5px] text-text-3">No deposits yet</p>
      )}
    </div>
  );
}
