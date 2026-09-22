"use client";

// =============================================================================
// Asset group
// =============================================================================
//
// One asset's markets of one instrument, under the current stage: the
// computed header with its overview strip, then the cards. Hourly groups are
// a time-ordered grid with day dividers and a fold once the settled hours
// pile up; daily groups are one ladder row per session, tightest rung first,
// with a placeholder where a rung was never posted.

import { useMemo, useState } from "react";

import { venueOfSymbol } from "@/lib/assets";
import { hourSlotsOf, leadHour, stageOf, windowLine, type Stage } from "@/lib/board";
import { dateOf, fmtDay, fmtTime, fmtWeekday } from "@/lib/clock";
import { fmtBps } from "@/lib/format";
import {
  TIER_META,
  TIER_ORDER,
  TIERS,
  type MarketKind,
  type MarketView,
  type PriceFeedView,
} from "@/lib/market";
import { VENUES, type Venue } from "@/lib/venue";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/primitives";
import AssetHeader from "./AssetHeader";
import LadderScale from "./LadderScale";
import MarketCard from "./MarketCard";
import SessionTape from "./SessionTape";

/** Settled hours shown before the rest fold away. A crypto day has twenty-four. */
const HOURS_BEFORE_FOLD = 8;
/** Settled hours a phone keeps while the rest are folded away. */
const PHONE_FOLD = 4;
/** Settled sessions shown before earlier ones fold away. */
const SESSIONS_BEFORE_FOLD = 2;

/** Scrolls to a card as soon as it exists; a stage switch renders it a tick later. */
function scrollWhenReady(key: string, tries = 20): void {
  const el = document.getElementById(key);
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  if (tries > 0) window.setTimeout(() => scrollWhenReady(key, tries - 1), 50);
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="mb-3 flex items-center gap-3" aria-hidden>
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-4">{label}</span>
      <span className="h-px flex-1 bg-line-1" />
    </div>
  );
}

/** Consecutive hours of the same day, in the order they were given. */
function byDay(hours: MarketView[], venue: Venue): { key: string; label: string; hours: MarketView[] }[] {
  const days: { key: string; label: string; hours: MarketView[] }[] = [];
  for (const m of hours) {
    const key = dateOf(m.lockTs, venue);
    const last = days[days.length - 1];
    if (last && last.key === key) last.hours.push(m);
    else days.push({ key, label: fmtDay(m.lockTs, venue), hours: [m] });
  }
  return days;
}

export default function AssetGroup({
  symbol,
  kind,
  all,
  shown,
  stage,
  now,
  feed,
  onStage,
}: {
  symbol: string;
  kind: MarketKind;
  /** Every market of this asset and instrument, all stages. */
  all: MarketView[];
  /** The ones under the current stage and filters. */
  shown: MarketView[];
  stage: Stage;
  now: number;
  feed: PriceFeedView | undefined;
  /** Asked when a strip click points at a market in another stage. */
  onStage: (stage: Stage) => void;
}) {
  const venue = venueOfSymbol(symbol);
  const [unfolded, setUnfolded] = useState(false);

  // A strip click lands on the card once it is rendered, which may be after
  // a stage switch and an unfold, so the scroll waits for the element.
  const select = (m: MarketView) => {
    const target = stageOf(m, now);
    if (target !== stage) onStage(target);
    setUnfolded(true);
    scrollWhenReady(m.key);
  };

  // Daily markets group by session; computed up here so the hook order is
  // the same whichever instrument this group renders.
  const sessions = useMemo(() => {
    const map = new Map<string, MarketView[]>();
    for (const m of shown) map.set(m.sessionId, [...(map.get(m.sessionId) ?? []), m]);
    const list = [...map.values()].map((rungs) => rungs.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]));
    list.sort((a, b) => (stage === "resolved" ? b[0].settleTs - a[0].settleTs : a[0].lockTs - b[0].lockTs));
    return list;
  }, [shown, stage]);

  // ---- hourly ---------------------------------------------------------------
  if (kind === "hourly") {
    const ordered = stage === "resolved" ? [...shown].sort((a, b) => b.settleTs - a.settleTs) : [...shown].sort((a, b) => a.lockTs - b.lockTs);
    const foldable = stage === "resolved" && ordered.length > HOURS_BEFORE_FOLD;
    const folded = foldable && !unfolded;
    const visible = folded ? ordered.slice(0, HOURS_BEFORE_FOLD) : ordered;
    // Crypto reads a threshold for every hour; an equities session reads one
    // the evening before and every hour of that session carries it. That is a
    // property of the venue, not something to infer from the numbers on hand.
    const perHour = venue === "crypto";
    const lead = leadHour(all, now);
    const ahead = all.filter((m) => m.lockTs > now).length;

    // The line speaks for one session: the lead hour's own day, so yesterday's
    // settled hours never inflate the count and a half day states its own span.
    const session = lead ? all.filter((m) => dateOf(m.lockTs, venue) === dateOf(lead.lockTs, venue)) : [];
    const whose = lead ? (dateOf(lead.lockTs, venue) === dateOf(now, venue) ? "Today's" : `${fmtWeekday(lead.lockTs, venue)}'s`) : "";
    const span =
      session.length > 0
        ? `${fmtTime(session[0].lockTs, venue)} to ${fmtTime(session[session.length - 1].settleTs, venue)} ${VENUES[venue].tz}`
        : "";

    // Cards keep to the hour and the clock; the day is said once, above the
    // grid it belongs to, and only when more than today is on screen.
    const days = byDay(visible, venue);
    const labelled = days.length > 1 || (days[0] !== undefined && days[0].key !== dateOf(now, venue));
    const rank = new Map(visible.map((m, i) => [m.key, i]));
    const hiddenOnPhone = (m: MarketView) => folded && (rank.get(m.key) ?? 0) >= PHONE_FOLD;

    // SessionTape prints "Next lock" under the strip whenever a posted hour
    // is still ahead, so the header does not print the same instant again.
    const slots = hourSlotsOf(venue, all, now);
    const tapeHasClock = slots.some((slot) => slot.market !== null && slot.lockTs > now);

    // Neither venue repeats the lede or the cards here. Crypto gets the range
    // its per-hour thresholds have actually taken, which no single card shows;
    // equities gets the one threshold the whole session runs on, and its span.
    const strikes = all.map((m) => m.strikeBps);
    const line = perHour
      ? all.length > 0
        ? `Thresholds have run ${fmtBps(Math.min(...strikes))} to ${fmtBps(Math.max(...strikes))} · ${ahead} hours posted ahead`
        : ""
      : lead
        ? `${whose} threshold ${fmtBps(lead.strikeBps)} · ${session.length} hours, ${span}`
        : "";

    return (
      <section className="animate-fade-up">
        <AssetHeader
          symbol={symbol}
          all={all}
          now={now}
          feed={feed}
          line={line}
          stage={stage}
          clock={!tapeHasClock}
          strip={<SessionTape slots={slots} venue={venue} now={now} feed={feed} onSelect={select} />}
        />
        {/* Each day is its own grid, so a day that ends mid row never leaves a
            hole in the next one and the heading belongs to what follows it. */}
        <div className="flex flex-col gap-6">
          {days.map((d) => (
            // A folded grid drops to four cards on a phone, so a day left with
            // none of them goes with its heading rather than heading a hole.
            <div key={d.key} className={cn(d.hours.every(hiddenOnPhone) && "hidden sm:block")}>
              {labelled && <DayDivider label={d.label} />}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {d.hours.map((m) => (
                  <MarketCard
                    key={m.key}
                    market={m}
                    now={now}
                    feed={feed}
                    mutedStrike={!perHour && all.length > 1}
                    className={cn(hiddenOnPhone(m) && "hidden sm:flex")}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {foldable && (
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setUnfolded((v) => !v)}>
            {folded ? `Show all ${ordered.length} hours` : `Show the latest ${HOURS_BEFORE_FOLD}`}
          </Button>
        )}
      </section>
    );
  }

  // ---- daily ----------------------------------------------------------------
  if (sessions.length === 0) return null;
  const foldable = stage === "resolved" && sessions.length > SESSIONS_BEFORE_FOLD;
  const folded = foldable && !unfolded;
  const visibleSessions = folded ? sessions.slice(0, SESSIONS_BEFORE_FOLD) : sessions;
  const primary = sessions[0];
  const line = windowLine(primary[0]);

  return (
    <section className="animate-fade-up">
      <AssetHeader
        symbol={symbol}
        all={all}
        now={now}
        feed={feed}
        line={line}
        stage={stage}
        strip={<LadderScale rungs={primary} feed={feed} />}
      />
      <div className="flex flex-col gap-5">
        {visibleSessions.map((rungs) => {
          const byTier = new Map(rungs.map((r) => [r.tier, r]));
          return (
            <div key={rungs[0].sessionId}>
              {sessions.length > 1 && (
                <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-4">
                  {fmtDay(rungs[0].lockTs, venue)} to {fmtDay(rungs[0].settleTs, venue)}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {TIERS.map((tier) => {
                  const m = byTier.get(tier);
                  return m ? (
                    <MarketCard key={m.key} market={m} now={now} feed={feed} levelFrom="md" />
                  ) : (
                    <div
                      key={`${rungs[0].sessionId}-${tier}`}
                      className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-line-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-4"
                    >
                      {TIER_META[tier].label} not posted
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {foldable && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setUnfolded((v) => !v)}>
          {folded ? `Show earlier sessions (${sessions.length - SESSIONS_BEFORE_FOLD})` : `Show the latest ${SESSIONS_BEFORE_FOLD}`}
        </Button>
      )}
    </section>
  );
}
