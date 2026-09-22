"use client";

// =============================================================================
// Ladder scale
// =============================================================================
//
// One session's three thresholds on a rank axis: TIGHT at a quarter, FAIR at
// half, WIDE at three quarters, whatever the numbers, so the labels never
// collide when WIDE is ten times TIGHT. While the session is live a marker
// shows how far the price has moved against the rungs; once settled it shows
// where the session ended. Open sessions show the rungs alone.

import { fmtBps, fmtPct } from "@/lib/format";
import {
  TIER_META,
  TIER_ORDER,
  moveBps,
  signedMovePct,
  type MarketView,
  type PriceFeedView,
  type Tier,
} from "@/lib/market";
import { cn, pinned } from "@/lib/utils";

const TICK_AT: Record<Tier, number> = { tight: 25, fair: 50, wide: 75 };

/** Where a move sits on the rank axis, interpolating between the rungs it has cleared. */
function positionOf(bps: number, strikes: Partial<Record<Tier, number>>): number {
  const s1 = strikes.tight ?? strikes.fair ?? strikes.wide ?? 1;
  const s2 = strikes.fair ?? s1;
  const s3 = strikes.wide ?? s2;
  const seg = (from: number, to: number, lo: number, hi: number) =>
    lo + ((to - lo) * Math.max(0, Math.min(1, (bps - from) / Math.max(1, hi - from))));
  if (bps <= s1) return seg(0, 25, 0, s1);
  if (bps <= s2) return seg(s1, 50, 25, s2);
  if (bps <= s3) return seg(s2, 75, 50, s3);
  return Math.min(100, 75 + (25 * (bps - s3)) / Math.max(1, s3));
}

export default function LadderScale({
  rungs,
  feed,
  className,
}: {
  /** The rungs of one session, any subset of tight, fair and wide. */
  rungs: MarketView[];
  feed: PriceFeedView | undefined;
  className?: string;
}) {
  if (rungs.length === 0) return null;
  const sorted = [...rungs].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const strikes: Partial<Record<Tier, number>> = {};
  for (const r of sorted) strikes[r.tier] = r.strikeBps;
  const lead = sorted[0];

  // One reference for the session: every rung locked at the same instant.
  const reference = lead.referencePrice;
  const settled = lead.state === "settled" && lead.settlementPrice > 0n;
  const live = lead.state === "locked" && reference > 0n && feed !== undefined && feed.price > 0n;
  const price = settled ? lead.settlementPrice : live ? feed!.price : null;
  const bps = price !== null ? moveBps(reference, price) : null;
  const signed = price !== null ? signedMovePct(reference, price) : null;
  const marker = bps !== null ? positionOf(bps, strikes) : null;

  return (
    <div className={cn("relative pt-4", className)}>
      {marker !== null && signed !== null && (
        <span
          className="absolute top-0 font-mono text-[11px] font-semibold tabular text-text-1"
          style={pinned(marker)}
        >
          {fmtPct(signed, { signed: true })}
        </span>
      )}
      <div className="relative h-1.5 rounded-full bg-white/[0.06]">
        {marker !== null && (
          <div
            // Neutral on purpose: this bar spans three markets at once, so it
            // cannot belong to either answer.
            className="absolute inset-y-0 left-0 rounded-full bg-white/25"
            style={{ width: `${marker}%` }}
          />
        )}
        {sorted.map((r) => {
          const cleared = bps !== null && bps > r.strikeBps;
          return (
            <span
              key={r.tier}
              className={cn("absolute -top-1 h-3.5 w-px", cleared ? "bg-above" : "bg-white/45")}
              style={{ left: `${TICK_AT[r.tier]}%` }}
              aria-hidden
            />
          );
        })}
        {marker !== null && (
          <span
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#06070A] bg-white"
            style={{ left: `${marker}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="relative mt-2 h-4 font-mono text-[10.5px] uppercase tracking-[0.1em]">
        {sorted.map((r) => {
          const cleared = bps !== null && bps > r.strikeBps;
          return (
            <span
              key={r.tier}
              className={cn("absolute whitespace-nowrap", cleared ? "text-above" : "text-text-3")}
              style={pinned(TICK_AT[r.tier])}
            >
              {TIER_META[r.tier].label} <span className="tabular">{fmtBps(r.strikeBps)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
