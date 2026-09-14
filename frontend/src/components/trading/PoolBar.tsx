"use client";

// =============================================================================
// Pool bar
// =============================================================================
//
// The two pools as one split bar, with what each side pays if it wins. The
// crowd's own odds, read straight off where the money sits.

import { fmtMultiple, fmtUsdx } from "@/lib/format";
import { payoutMultiple, poolShare, pot, type MarketView, type Side } from "@/lib/market";
import { cn } from "@/lib/utils";

export default function PoolBar({
  market,
  size = "md",
  highlight,
  showPayouts = true,
  className,
}: {
  market: MarketView;
  size?: "sm" | "md";
  /** Emphasise one side, typically the winner or the user's side. */
  highlight?: Side | null;
  showPayouts?: boolean;
  className?: string;
}) {
  const total = pot(market);
  const empty = total === 0n;
  const aboveShare = empty ? 0.5 : poolShare(market, "above");
  const abovePct = Math.round(aboveShare * 100);
  const belowPct = 100 - abovePct;
  const aboveMultiple = payoutMultiple(market, "above");
  const belowMultiple = payoutMultiple(market, "below");
  const sm = size === "sm";

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "flex items-center justify-between gap-2 font-mono tabular",
          sm ? "text-[10px]" : "text-[11px]",
        )}
      >
        <span className={cn("truncate", highlight === "below" ? "text-text-4" : "text-above")}>
          <span className="font-semibold">ABOVE</span>
          <span className="text-text-3"> · </span>
          {fmtUsdx(market.abovePool, { compact: true })}
          {!empty && <span className="text-text-4"> {abovePct}%</span>}
        </span>
        <span className={cn("truncate text-right", highlight === "above" ? "text-text-4" : "text-below")}>
          {!empty && <span className="text-text-4">{belowPct}% </span>}
          {fmtUsdx(market.belowPool, { compact: true })}
          <span className="text-text-3"> · </span>
          <span className="font-semibold">BELOW</span>
        </span>
      </div>

      <div className={cn("mt-1.5 flex w-full overflow-hidden rounded-full bg-white/[0.05]", sm ? "h-1.5" : "h-2")}>
        {empty ? (
          <div className="w-full h-full bg-white/[0.04]" />
        ) : (
          <>
            <div
              className={cn(
                "h-full transition-[width] duration-500",
                highlight === "below" ? "bg-above/30" : "bg-above",
              )}
              style={{ width: `${aboveShare * 100}%` }}
            />
            <div
              className={cn(
                "h-full flex-1 transition-[width] duration-500",
                highlight === "above" ? "bg-below/30" : "bg-below",
              )}
            />
          </>
        )}
      </div>

      {showPayouts && (
        <div
          className={cn(
            "mt-1.5 flex items-center justify-between gap-2 font-mono tabular text-text-3",
            sm ? "text-[9.5px]" : "text-[10.5px]",
          )}
        >
          <span>
            pays <span className="text-text-1">{fmtMultiple(aboveMultiple)}</span>
          </span>
          <span className="text-text-4">
            pot {fmtUsdx(total, { compact: true })} USDX
          </span>
          <span>
            pays <span className="text-text-1">{fmtMultiple(belowMultiple)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
