// =============================================================================
// Grouping markets for display
// =============================================================================
//
// A daily ladder is three markets that differ only by tier; an hourly session
// is six markets that differ only by slot. The trading page shows those as
// one unit each, so the grouping lives here, pure and testable.

import { fmtEtDay } from "./calendar";
import {
  ladderId,
  phaseOf,
  TIER_ORDER,
  type MarketKind,
  type MarketPhase,
  type MarketView,
} from "./market";

export interface MarketGroup {
  id: string;
  symbol: string;
  kind: MarketKind;
  /** The shared session for a daily ladder, the day for an hourly session. */
  sessionId: string;
  dayLabel: string;
  markets: MarketView[];
  /** Earliest lock and latest settle across the group. */
  lockTs: number;
  settleTs: number;
}

export function groupMarkets(markets: MarketView[]): MarketGroup[] {
  const map = new Map<string, MarketGroup>();

  for (const m of markets) {
    const id = m.kind === "daily" ? `daily|${ladderId(m)}` : `hourly|${m.symbol}|${fmtEtDay(m.lockTs)}`;
    let group = map.get(id);
    if (!group) {
      group = {
        id,
        symbol: m.symbol,
        kind: m.kind,
        sessionId: m.sessionId,
        dayLabel: fmtEtDay(m.lockTs),
        markets: [],
        lockTs: m.lockTs,
        settleTs: m.settleTs,
      };
      map.set(id, group);
    }
    group.markets.push(m);
    group.lockTs = Math.min(group.lockTs, m.lockTs);
    group.settleTs = Math.max(group.settleTs, m.settleTs);
  }

  for (const group of map.values()) {
    group.markets.sort((a, b) =>
      group.kind === "daily" ? TIER_ORDER[a.tier] - TIER_ORDER[b.tier] : a.lockTs - b.lockTs,
    );
  }

  return [...map.values()];
}

export type Tab = "open" | "live" | "resolved";

export const TAB_META: Record<Tab, { label: string; empty: string }> = {
  open: { label: "Open", empty: "No markets are taking deposits right now." },
  live: { label: "Live", empty: "No markets are being measured right now." },
  resolved: { label: "Resolved", empty: "Nothing has settled yet." },
};

export function tabOf(phase: MarketPhase): Tab {
  switch (phase) {
    case "deposits":
    case "awaiting-lock":
      return "open";
    case "live":
    case "awaiting-settle":
      return "live";
    default:
      return "resolved";
  }
}

/**
 * What a group currently holds, by tab, in display order.
 *
 * The board filters markets and then groups whatever survives, so a group
 * can hold one hour or all six. This is how its header says which, instead
 * of assuming the group is whole.
 */
export function groupSummary(group: MarketGroup, nowSec: number): { n: number; label: string }[] {
  const counts: Record<Tab, number> = { open: 0, live: 0, resolved: 0 };
  for (const m of group.markets) counts[tabOf(phaseOf(m, nowSec))]++;
  return (
    [
      { n: counts.open, label: "open" },
      { n: counts.live, label: "live" },
      { n: counts.resolved, label: "settled" },
    ] as const
  )
    .filter((part) => part.n > 0)
    .map((part) => ({ ...part }));
}

/** The earliest time anything in the group changes state next. */
export function nextEventTs(group: MarketGroup, nowSec: number): number | null {
  let next: number | null = null;
  for (const m of group.markets) {
    const phase = phaseOf(m, nowSec);
    const ts = phase === "deposits" ? m.lockTs : phase === "live" ? m.settleTs : null;
    if (ts !== null && (next === null || ts < next)) next = ts;
  }
  return next;
}
