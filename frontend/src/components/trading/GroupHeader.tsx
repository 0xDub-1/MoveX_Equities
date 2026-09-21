"use client";

// =============================================================================
// Group header
// =============================================================================
//
// The line above a ladder or an hourly session: which stock, what kind of
// market, what the stock is trading at, and what the group adds up to. The
// price sits here rather than in a panel of its own, because this is where
// it means something.

import type { ReactNode } from "react";

import { assetName } from "@/lib/assets";
import { fmtPrice, fmtUsdx } from "@/lib/format";
import { priceToNumber, type PriceFeedView } from "@/lib/market";
import { cn } from "@/lib/utils";
import { isFeedFresh } from "@/hooks/usePriceFeeds";

import { Badge } from "@/components/ui/primitives";

export default function GroupHeader({
  symbol,
  kind,
  badge,
  description,
  feed,
  now,
  pot,
  trailing,
}: {
  symbol: string;
  kind: "Daily" | "Hourly";
  /** The group's phase badge, when every market in it shares one. */
  badge?: ReactNode;
  description: ReactNode;
  feed: PriceFeedView | undefined;
  now: number;
  /** Total across the group, in USDX base units. */
  pot: bigint;
  /** Extra summary on the right, after the pot. */
  trailing?: ReactNode;
}) {
  const hasPrice = !!feed && feed.price > 0n;
  const fresh = isFeedFresh(feed, now);

  return (
    <header className="mb-3.5 flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-display text-[22px] font-semibold leading-none tracking-tight text-text-1">
            {symbol}
          </span>
          <span className="text-[13px] text-text-3">{assetName(symbol) ?? ""}</span>
          {hasPrice && (
            <span className="flex items-center gap-1.5 border-l border-line-2 pl-3">
              <span className="font-mono text-[14px] font-semibold tabular text-text-1">
                {fmtPrice(priceToNumber(feed.price))}
              </span>
              <span
                className={cn("h-1.5 w-1.5 rounded-full", fresh ? "bg-brand" : "bg-warning/70")}
                title={fresh ? "Live price" : "The last print is over two minutes old"}
              />
            </span>
          )}
          <Badge size="sm">{kind}</Badge>
          {badge}
        </div>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-text-2">{description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-4 font-mono text-[12px] tabular text-text-3">
        <span>
          Pot <span className="text-text-1">{fmtUsdx(pot, { compact: true })}</span> USDX
        </span>
        {trailing}
      </div>
    </header>
  );
}
