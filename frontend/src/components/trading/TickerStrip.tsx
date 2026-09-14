"use client";

// =============================================================================
// Ticker strip
// =============================================================================
//
// One cell per listed stock: the oracle's latest print and how fresh it is,
// in words, the thresholds in play today, and how many markets are open.
// Clicking a cell filters the board to that ticker.

import { useMemo } from "react";

import { fmtEtDateTime } from "@/lib/calendar";
import { TICKERS, TICKER_NAMES, type Ticker } from "@/lib/config";
import { fmtAgo, fmtBps, fmtPct, fmtPrice } from "@/lib/format";
import {
  TIER_ORDER,
  phaseOf,
  priceToNumber,
  signedMovePct,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { isFeedFresh } from "@/hooks/usePriceFeeds";

import { Skeleton } from "@/components/ui/primitives";

interface TickerCellProps {
  symbol: Ticker;
  feed: PriceFeedView | undefined;
  markets: MarketView[];
  now: number;
  selected: boolean;
  onSelect: () => void;
}

function TickerCell({ symbol, feed, markets, now, selected, onSelect }: TickerCellProps) {
  const hasPrice = !!feed && feed.price > 0n;
  const fresh = isFeedFresh(feed, now);
  const price = hasPrice ? priceToNumber(feed.price) : null;

  const model = useMemo(() => {
    const mine = markets.filter((m) => m.symbol === symbol);
    const open = mine.filter((m) => phaseOf(m, now) === "deposits").length;

    // The most recent locked daily market carries the last close as its
    // reference, which is the honest anchor for "since last close".
    const lastClose = mine
      .filter((m) => m.kind === "daily" && m.state === "locked" && m.referencePrice > 0n)
      .sort((a, b) => b.lockTs - a.lockTs)[0]?.referencePrice;

    // The daily ladder in play: the session locking soonest that is not resolved.
    const session = mine
      .filter((m) => m.kind === "daily" && (m.state === "open" || m.state === "locked"))
      .sort((a, b) => a.lockTs - b.lockTs)[0]?.sessionId;
    const ladder = session
      ? mine
          .filter((m) => m.kind === "daily" && m.sessionId === session)
          .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
      : [];

    return { open, lastClose, ladder };
  }, [markets, symbol, now]);

  const sinceClose =
    model.lastClose && hasPrice ? signedMovePct(model.lastClose, feed.price) : null;

  const freshness = (() => {
    if (!feed) return { label: "Loading", tone: "text-text-4", dot: "offline" };
    if (fresh) return { label: "Live", tone: "text-text-2", dot: "" };
    if (hasPrice) return { label: `Last print ${fmtAgo(now - feed.publishTime)}`, tone: "text-text-3", dot: "idle" };
    return { label: "No prints yet", tone: "text-text-3", dot: "offline" };
  })();

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-md border p-4 text-left transition-colors",
        selected
          ? "border-line-3 bg-surface-3"
          : "border-line-2 bg-surface-2 hover:border-line-3 hover:bg-surface-3/70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-[18px] font-semibold tracking-tight text-text-1">{symbol}</span>
          <span className="truncate text-[12.5px] text-text-3">{TICKER_NAMES[symbol]}</span>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-2 text-[11.5px] font-medium", freshness.tone)}>
          <span className={cn("status-dot", freshness.dot)} />
          {freshness.label}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        {feed === undefined ? (
          <Skeleton className="h-8 w-32" />
        ) : price === null ? (
          <span className="font-display text-[30px] font-semibold tabular tracking-tight text-text-4 leading-none">
            --
          </span>
        ) : (
          <span className="font-display text-[30px] font-semibold tabular tracking-tight text-text-1 leading-none">
            {fmtPrice(price)}
          </span>
        )}
        {sinceClose !== null && (
          <span className={cn("font-mono text-[13px] tabular", sinceClose >= 0 ? "text-above" : "text-loss")}>
            {fmtPct(sinceClose, { signed: true })}
            <span className="text-text-3"> since last close</span>
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] text-text-3">
        {fresh && feed
          ? `Published ${fmtEtDateTime(feed.publishTime)}`
          : "Prices publish during the session, 09:30 to 16:00 ET."}
      </p>

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line-1 pt-3">
        <div className="flex items-baseline gap-2 min-w-0 text-[12px]">
          <span className="text-text-3">Thresholds</span>
          {model.ladder.length > 0 ? (
            <span className="font-mono tabular text-text-1">
              {model.ladder.map((m) => fmtBps(m.strikeBps)).join("  ·  ")}
            </span>
          ) : (
            <span className="text-text-4">none listed yet</span>
          )}
        </div>
        <span className="shrink-0 text-[12px] text-text-3">
          {model.open > 0 ? (
            <>
              <span className="font-mono tabular text-brand">{model.open}</span> open
            </>
          ) : (
            "none open"
          )}
        </span>
      </div>
    </button>
  );
}

export default function TickerStrip({
  feeds,
  markets,
  now,
  selected,
  onSelect,
}: {
  feeds: Record<string, PriceFeedView> | undefined;
  markets: MarketView[];
  now: number;
  selected: Ticker | "all";
  onSelect: (symbol: Ticker | "all") => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {TICKERS.map((symbol) => (
        <TickerCell
          key={symbol}
          symbol={symbol}
          feed={feeds?.[symbol]}
          markets={markets}
          now={now}
          selected={selected === symbol}
          onSelect={() => onSelect(selected === symbol ? "all" : symbol)}
        />
      ))}
    </div>
  );
}
