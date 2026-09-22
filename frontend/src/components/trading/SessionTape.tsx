"use client";

// =============================================================================
// Session tape
// =============================================================================
//
// One asset's hourly day as a strip of cells on a fixed axis, one cell per
// hour whether or not a market exists for it. Only a settled hour takes a
// side's colour; the hour running now is white and pulses, an hour still
// open is a plain grey block, an hour never posted is barely there. A marker
// says where now is. Clicking a cell takes the reader to that hour's card,
// unfolding and switching stage if it has to.

import { fmtTime } from "@/lib/clock";
import type { HourSlot } from "@/lib/board";
import { fmtPct } from "@/lib/format";
import { phaseOf, signedMovePct, type MarketView, type PriceFeedView } from "@/lib/market";
import { HOUR_SECS } from "@/lib/sessions";
import { cn, pinned } from "@/lib/utils";
import { VENUES, type Venue } from "@/lib/venue";

import { Countdown } from "@/components/ui/primitives";

function cellClass(m: MarketView | null, nowSec: number): string {
  if (!m) return "bg-white/[0.05]";
  const phase = phaseOf(m, nowSec);
  switch (phase) {
    case "settled":
      return m.winningSide === "above" ? "bg-above/80" : "bg-below/70";
    case "live":
    case "awaiting-settle":
      return "bg-text-1 animate-pulse-soft";
    case "deposits":
    case "awaiting-lock":
      return "bg-white/[0.22]";
    default:
      return "bg-loss/50";
  }
}

function cellTitle(slot: HourSlot, venue: Venue, nowSec: number, feed: PriceFeedView | undefined): string {
  const range = `${fmtTime(slot.lockTs, venue)} to ${fmtTime(slot.lockTs + HOUR_SECS, venue)} ${VENUES[venue].tz}`;
  const m = slot.market;
  if (!m) return `${range} · not posted`;
  const phase = phaseOf(m, nowSec);
  if (phase === "settled" && m.winningSide) {
    const moved = m.referencePrice > 0n ? fmtPct(signedMovePct(m.referencePrice, m.settlementPrice), { signed: true }) : "";
    return `${range} · ${m.winningSide === "above" ? "YES" : "NO"} won${moved ? ` · ${moved}` : ""}`;
  }
  if (phase === "live" || phase === "awaiting-settle") {
    const moved =
      m.referencePrice > 0n && feed ? ` · ${fmtPct(signedMovePct(m.referencePrice, feed.price), { signed: true })} so far` : "";
    return `${range} · live${moved}`;
  }
  if (phase === "deposits" || phase === "awaiting-lock") return `${range} · open`;
  return `${range} · refund`;
}

export default function SessionTape({
  slots,
  venue,
  now,
  feed,
  onSelect,
  className,
}: {
  slots: HourSlot[];
  venue: Venue;
  now: number;
  feed: PriceFeedView | undefined;
  onSelect: (market: MarketView) => void;
  className?: string;
}) {
  if (slots.length === 0) return null;
  const start = slots[0].lockTs;
  const span = slots.length * HOUR_SECS;
  const nowPct = Math.max(0, Math.min(100, ((now - start) / span) * 100));
  const showNow = now >= start && now <= start + span;
  const every = slots.length > 8 ? 3 : 1;
  // An hour that was never posted has a cell but no lock to count down to.
  const next = slots.find((s) => s.market !== null && s.lockTs > now);

  return (
    <div className={cn("relative pt-4", className)}>
      {showNow && (
        <span
          className="absolute top-0 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-text-2"
          style={pinned(nowPct)}
        >
          now
        </span>
      )}
      <div className="relative">
        <div className="flex gap-[2px]">
          {slots.map((slot) => {
            const m = slot.market;
            const cls = cellClass(m, now);
            const common = "h-2 min-w-0 flex-1 rounded-[1px] transition-colors";
            return m ? (
              <button
                key={slot.lockTs}
                type="button"
                title={cellTitle(slot, venue, now, feed)}
                onClick={() => onSelect(m)}
                className={cn(common, cls, "cursor-pointer hover:brightness-125")}
                aria-label={cellTitle(slot, venue, now, feed)}
              />
            ) : (
              <span key={slot.lockTs} title={cellTitle(slot, venue, now, feed)} className={cn(common, cls)} />
            );
          })}
        </div>
        {showNow && (
          <span
            className="pointer-events-none absolute -inset-y-1 w-px bg-white/60"
            style={{ left: `${nowPct}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1 flex gap-[2px] font-mono text-[10px] tabular text-text-4">
        {slots.map((slot, i) => (
          <span key={slot.lockTs} className="min-w-0 flex-1 truncate">
            {i % every === 0 ? fmtTime(slot.lockTs, venue).slice(0, 2) : ""}
          </span>
        ))}
      </div>
      {next && (
        <p className="mt-1 font-mono text-[10.5px] tabular text-text-4">
          Next lock {fmtTime(next.lockTs, venue)} {VENUES[venue].tz} · <Countdown to={next.lockTs} className="text-text-3" />
        </p>
      )}
    </div>
  );
}
