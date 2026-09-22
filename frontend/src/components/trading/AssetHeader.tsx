"use client";

// =============================================================================
// Asset header
// =============================================================================
//
// The three lines above one asset's cards: who this is and what it trades
// at, an overview strip of the instrument (the hourly tape or the ladder
// scale), and one line of facts about the threshold and the window. Computed
// from the markets rather than handed prose, so equities and crypto, hourly
// and daily, cannot drift apart.

import type { ReactNode } from "react";

import { assetName } from "@/lib/assets";
import { stageOf, type Stage } from "@/lib/board";
import { fmtPrice, fmtUsdx } from "@/lib/format";
import { phaseOf, pot, priceToNumber, type MarketView, type PriceFeedView } from "@/lib/market";
import { cn } from "@/lib/utils";
import { isFeedFresh } from "@/hooks/usePriceFeeds";

import { Countdown } from "@/components/ui/primitives";

/** The soonest lock or settle among the markets, for the header clock. */
function nextMoment(markets: readonly MarketView[], now: number): { ts: number; kind: "lock" | "settle" } | null {
  let best: { ts: number; kind: "lock" | "settle" } | null = null;
  for (const m of markets) {
    const phase = phaseOf(m, now);
    const ts = phase === "deposits" ? m.lockTs : phase === "live" ? m.settleTs : null;
    if (ts === null || ts <= now) continue;
    const kind = phase === "deposits" ? ("lock" as const) : ("settle" as const);
    if (!best || ts < best.ts) best = { ts, kind };
  }
  return best;
}

export default function AssetHeader({
  symbol,
  all,
  now,
  feed,
  strip,
  line,
  stage,
  clock = true,
}: {
  symbol: string;
  /** Every market of this asset and instrument, all stages, for the counts. */
  all: readonly MarketView[];
  now: number;
  feed: PriceFeedView | undefined;
  /** The instrument's overview: a SessionTape or a LadderScale. */
  strip: ReactNode;
  /** The lifecycle the board is showing, which scopes the money. */
  stage: Stage;
  /** False when the strip below already names the next moment. */
  clock?: boolean;
  /** One line of facts, plain text. */
  line: string;
}) {
  const hasPrice = !!feed && feed.price > 0n;
  const fresh = isFeedFresh(feed, now);
  // The money is summed over the stage the board is showing, so the asset
  // rows add up to the total printed above them.
  const counts: Record<Stage, number> = { open: 0, live: 0, resolved: 0 };
  let shownPot = 0n;
  for (const m of all) {
    const at = stageOf(m, now);
    counts[at]++;
    if (at === stage) shownPot += pot(m);
  }
  const next = nextMoment(all, now);

  // One phrase per fact, in lifecycle order, with this asset's share of the
  // money sitting beside the count it belongs to rather than repeating the
  // stage word the board has already said twice.
  const facts: ReactNode[] = [];
  for (const s of ["open", "live", "resolved"] as Stage[]) {
    if (counts[s] === 0) continue;
    facts.push(
      <>
        <span className="text-text-1">{counts[s]}</span> {s === "resolved" ? "settled" : s}
      </>,
    );
    if (s === stage && shownPot > 0n) {
      facts.push(
        <>
          <span className="text-text-1">{fmtUsdx(shownPot, { compact: true })}</span> USDX
        </>,
      );
    }
  }
  if (next && clock) {
    facts.push(
      <>
        {next.kind === "lock" ? "Locks in " : "Settles in "}
        <Countdown to={next.ts} className="text-text-1" />
      </>,
    );
  }

  return (
    <header className="mb-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-baseline lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[22px] font-semibold leading-none tracking-tight text-text-1">
            {symbol}
          </span>
          <span className="text-[13px] text-text-3">{assetName(symbol) ?? ""}</span>
          {hasPrice && (
            <span className="flex items-center gap-1.5 border-l border-line-2 pl-3">
              <span className="font-mono text-[15px] font-semibold tabular text-text-1">
                {fmtPrice(priceToNumber(feed.price))}
              </span>
              <span
                className={cn("h-1.5 w-1.5 rounded-full", fresh ? "bg-brand" : "bg-warning/70")}
                title={fresh ? "Live price" : "The last print is over two minutes old"}
              />
            </span>
          )}
        </div>
        {/* Every phrase is a block of its own, so a narrow screen breaks
            between them and never inside one. */}
        <p className="shrink-0 font-mono text-[12px] tabular text-text-3">
          {facts.map((fact, i) => (
            <span key={i}>
              <span className="whitespace-nowrap">
                {fact}
                {i < facts.length - 1 && <span className="text-text-4"> ·</span>}
              </span>
              {i < facts.length - 1 && " "}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-2">{strip}</div>

      <p className="mt-2 line-clamp-2 font-mono text-[11.5px] tabular text-text-3" title={line}>
        {line}
      </p>
    </header>
  );
}
