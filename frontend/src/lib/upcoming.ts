// =============================================================================
// What happens next
// =============================================================================
//
// The board sorts by the soonest market, but reading a sort is not the same
// as being told. This finds the very next moment anything changes state, so
// one line at the top can say it outright.

import { venueOfSymbol } from "./assets";
import { fmtTime } from "./clock";
import { TIER_META, phaseOf, type MarketView } from "./market";

export interface UpcomingEvent {
  /** Unix seconds. */
  ts: number;
  kind: "lock" | "settle";
  /** How many markets share this moment. */
  count: number;
  /** What to call them. */
  label: string;
  /** Where to go when there is exactly one. */
  href: string | null;
}

function nameOf(m: MarketView): string {
  if (m.kind === "hourly") {
    return `${m.symbol} ${fmtTime(m.lockTs, venueOfSymbol(m.symbol))} hour`;
  }
  return `${m.symbol} ${TIER_META[m.tier].label}`;
}

/**
 * The next lock or settle across every market, with the markets that share
 * that moment counted together. A daily ladder locks nine markets at once,
 * and saying so reads better than naming one of them.
 */
export function nextEvent(markets: MarketView[], nowSec: number): UpcomingEvent | null {
  if (!nowSec) return null;

  let best: { ts: number; kind: "lock" | "settle" } | null = null;
  const at: MarketView[] = [];

  for (const m of markets) {
    const phase = phaseOf(m, nowSec);
    let ts: number | null = null;
    let kind: "lock" | "settle" | null = null;

    if (phase === "deposits") {
      ts = m.lockTs;
      kind = "lock";
    } else if (phase === "live") {
      ts = m.settleTs;
      kind = "settle";
    }
    // Awaiting states have no future moment: they are already late.
    if (ts === null || kind === null || ts <= nowSec) continue;

    if (!best || ts < best.ts) {
      best = { ts, kind };
      at.length = 0;
      at.push(m);
    } else if (ts === best.ts && kind === best.kind) {
      at.push(m);
    }
  }

  if (!best) return null;

  const symbols = new Set(at.map((m) => m.symbol));
  const label =
    at.length === 1
      ? nameOf(at[0])
      : symbols.size === 1
        ? `${at.length} ${at[0].symbol} markets`
        : `${at.length} markets`;

  return {
    ts: best.ts,
    kind: best.kind,
    count: at.length,
    label,
    href: at.length === 1 ? `/market/${at[0].key}` : null,
  };
}
