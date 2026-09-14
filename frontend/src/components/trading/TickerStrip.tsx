"use client";

// =============================================================================
// Ticker strip
// =============================================================================
//
// One cell per listed ticker: the oracle's latest print, how fresh it is,
// the move since the last recorded close, the day's ladder, and how many
// markets are open on it.

import { useEffect, useMemo } from "react";
import Link from "next/link";

import { TICKERS, TICKER_NAMES, type Ticker } from "@/lib/config";
import { fmtAgo, fmtBps, fmtPct, fmtPrice } from "@/lib/format";
import {
  phaseOf,
  priceToNumber,
  signedMovePct,
  TIER_ORDER,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { isFeedFresh } from "@/hooks/usePriceFeeds";
import { usePriceHistory, type PricePoint } from "@/store/priceHistory";

import { Eyebrow, Skeleton, Surface } from "@/components/ui/primitives";
import Sparkline from "./Sparkline";

// A stable empty series. A selector that returned a fresh `[]` would hand
// React a new snapshot on every call and loop forever.
const NO_POINTS: PricePoint[] = [];

interface TickerCellProps {
  symbol: Ticker;
  feed: PriceFeedView | undefined;
  markets: MarketView[];
  now: number;
  selected: boolean;
  onSelect: () => void;
}

function TickerCell({ symbol, feed, markets, now, selected, onSelect }: TickerCellProps) {
  const points = usePriceHistory((s) => s.series[symbol] ?? NO_POINTS);
  const fresh = isFeedFresh(feed, now);
  const price = feed && feed.price > 0n ? priceToNumber(feed.price) : null;

  const model = useMemo(() => {
    const mine = markets.filter((m) => m.symbol === symbol);
    const openDaily = mine.filter(
      (m) => m.kind === "daily" && ["deposits", "awaiting-lock", "live"].includes(phaseOf(m, now)),
    );
    const openHourly = mine.filter((m) => m.kind === "hourly" && phaseOf(m, now) === "deposits");

    // The most recent locked daily market carries yesterday's close as its
    // reference, which is the honest "since last close" anchor.
    const lastClose = mine
      .filter((m) => m.kind === "daily" && m.state === "locked" && m.referencePrice > 0n)
      .sort((a, b) => b.lockTs - a.lockTs)[0]?.referencePrice;

    // The ladder currently in play: the daily session locking soonest.
    const ladderSession = openDaily.sort((a, b) => a.lockTs - b.lockTs)[0]?.sessionId;
    const ladder = ladderSession
      ? mine
          .filter((m) => m.kind === "daily" && m.sessionId === ladderSession)
          .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
      : [];

    return {
      dailyOpen: openDaily.filter((m) => phaseOf(m, now) === "deposits").length,
      hourlyOpen: openHourly.length,
      lastClose,
      ladder,
    };
  }, [markets, symbol, now]);

  const sinceClose =
    model.lastClose && feed && feed.price > 0n ? signedMovePct(model.lastClose, feed.price) : null;
  const hasPrice = !!feed && feed.price > 0n;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-left w-full rounded-md border transition-colors surface-highlight overflow-hidden",
        selected
          ? "border-line-3 bg-surface-2"
          : "border-line-1 bg-surface-1 hover:border-line-2 hover:bg-surface-2/60",
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[17px] font-semibold tracking-tight text-text-1">
                {symbol}
              </span>
              <span className="text-[11px] text-text-3 truncate">{TICKER_NAMES[symbol]}</span>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase shrink-0",
              fresh ? "text-text-2" : "text-text-4",
            )}
          >
            <span className={cn("status-dot", !fresh && (hasPrice ? "idle" : "offline"))} />
            {fresh ? "Live" : hasPrice ? "Stale" : "No price"}
          </span>
        </div>

        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {price === null ? (
              feed === undefined ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <span className="font-display text-[26px] font-semibold tabular tracking-tight text-text-4 leading-none">
                  --
                </span>
              )
            ) : (
              <span className="font-display text-[26px] font-semibold tabular tracking-tight text-text-1 leading-none">
                {fmtPrice(price)}
              </span>
            )}
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] tabular">
              {sinceClose !== null ? (
                <span className={sinceClose >= 0 ? "text-above" : "text-loss"}>
                  {fmtPct(sinceClose, { signed: true })}
                  <span className="text-text-4"> vs last close</span>
                </span>
              ) : hasPrice && feed ? (
                <span className="text-text-4">Published {now ? fmtAgo(now - feed.publishTime) : ""}</span>
              ) : (
                <span className="text-text-4">Publishes during the session</span>
              )}
            </div>
          </div>
          <div className="w-24 sm:w-28 shrink-0">
            <Sparkline points={points} />
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-line-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] tabular text-text-3 min-w-0">
            {model.ladder.length > 0 ? (
              <>
                <Eyebrow size="sm">Ladder</Eyebrow>
                {model.ladder.map((m) => (
                  <span key={m.key} className="text-text-2">
                    {fmtBps(m.strikeBps)}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-text-4">No ladder in play</span>
            )}
          </div>
          <span className="font-mono text-[10px] tabular text-text-3 whitespace-nowrap">
            {model.dailyOpen + model.hourlyOpen > 0 ? (
              <>
                <span className="text-brand">{model.dailyOpen + model.hourlyOpen}</span> open
              </>
            ) : (
              "none open"
            )}
          </span>
        </div>
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
  const push = usePriceHistory((s) => s.push);

  // Every print the tab sees becomes a sparkline point.
  useEffect(() => {
    if (!feeds) return;
    for (const feed of Object.values(feeds)) {
      if (feed.price > 0n) push(feed.symbol, { t: feed.publishTime, p: priceToNumber(feed.price) });
    }
  }, [feeds, push]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

/** Kept for pages that want a plain link to the strip's ticker. */
export function TickerLink({ symbol }: { symbol: string }) {
  return (
    <Link href="/trading" className="font-display font-semibold text-text-1 hover:text-brand transition-colors">
      {symbol}
    </Link>
  );
}

export { Surface as TickerSurface };
