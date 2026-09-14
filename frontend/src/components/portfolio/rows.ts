// =============================================================================
// Position rows
// =============================================================================
//
// A position only means something next to its market, so the portfolio joins
// the two once and every panel reads the same row: the phase, what a claim
// would pay, what the position made or lost.

import { fmtEtDay, fmtEtTime, fmtSessionDate } from "@/lib/calendar";
import { fmtBps } from "@/lib/format";
import {
  TIER_META,
  byLockThenTier,
  bySettleDesc,
  claimAmount,
  isResolved,
  phaseOf,
  positionPnl,
  type MarketPhase,
  type MarketView,
  type PositionView,
  type Tone,
} from "@/lib/market";
import type { PnlCardData } from "@/lib/pnl-card";
import type { useMarketActions } from "@/hooks/useMarketActions";

export type MarketActions = ReturnType<typeof useMarketActions>;

export interface PositionRow {
  position: PositionView;
  market: MarketView;
  phase: MarketPhase;
  /** What a claim pays right now. Zero when there is nothing to collect. */
  claimable: bigint;
  /** Realised result on a resolved market. Null while it is still running. */
  pnl: bigint | null;
}

export type Tab = "active" | "claimable" | "history";

/** How a position on a resolved market ended. */
export type Outcome = "won" | "lost" | "refund" | "claimed" | "withdrawn";

export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone }> = {
  won: { label: "Won", tone: "brand" },
  lost: { label: "Lost", tone: "rose" },
  refund: { label: "Refund", tone: "amber" },
  claimed: { label: "Claimed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

/**
 * Phases where the stake is still committed to a market that has not
 * resolved. Expired belongs here: the market cannot settle, but the money is
 * locked up until someone voids it, so hiding the row would lose it.
 */
const RUNNING: ReadonlySet<MarketPhase> = new Set<MarketPhase>([
  "deposits",
  "awaiting-lock",
  "live",
  "awaiting-settle",
  "expired",
]);

/**
 * Joins positions to their markets. Rows are only built once the clock has
 * started, since a phase without a clock is a guess.
 */
export function buildRows(
  positions: PositionView[] | undefined,
  marketByKey: ReadonlyMap<string, MarketView>,
  nowSec: number,
): PositionRow[] {
  if (!nowSec || !positions) return [];
  const rows: PositionRow[] = [];
  for (const position of positions) {
    const market = marketByKey.get(position.marketKey);
    // A position whose market is not in the list cannot be shown honestly.
    if (!market) continue;
    rows.push({
      position,
      market,
      phase: phaseOf(market, nowSec),
      claimable: claimAmount(market, position),
      pnl: positionPnl(market, position),
    });
  }
  return rows;
}

export function isActiveRow(row: PositionRow): boolean {
  return RUNNING.has(row.phase) && row.position.amount > 0n;
}

export function isClaimableRow(row: PositionRow): boolean {
  return row.claimable > 0n;
}

/** Resolved with nothing left to collect: claimed, lost, or withdrawn in full. */
export function isHistoryRow(row: PositionRow): boolean {
  return isResolved(row.market) && row.claimable === 0n;
}

const TAB_FILTER: Record<Tab, (row: PositionRow) => boolean> = {
  active: isActiveRow,
  claimable: isClaimableRow,
  history: isHistoryRow,
};

const TAB_SORT: Record<Tab, (a: PositionRow, b: PositionRow) => number> = {
  active: (a, b) => byLockThenTier(a.market, b.market),
  claimable: (a, b) => bySettleDesc(a.market, b.market),
  history: (a, b) => bySettleDesc(a.market, b.market),
};

export function filterRows(rows: PositionRow[], tab: Tab): PositionRow[] {
  return rows.filter(TAB_FILTER[tab]).sort(TAB_SORT[tab]);
}

/** Null while the market is still running. */
export function outcomeOf(row: PositionRow): Outcome | null {
  const { market, position } = row;
  if (!isResolved(market)) return null;
  if (position.amount === 0n) return "withdrawn";
  if (market.state === "settled" && position.side !== market.winningSide) return "lost";
  if (position.claimed) return "claimed";
  return market.state === "voided" ? "refund" : "won";
}

/** `NVDA · FAIR · 1.55%`. */
export function marketTitle(m: MarketView): string {
  return `${m.symbol} · ${TIER_META[m.tier].label} · ${fmtBps(m.strikeBps)}`;
}

/** The window the market measures, in New York time. */
export function windowLabel(m: MarketView): string {
  if (m.kind === "daily") return fmtSessionDate(m.sessionId);
  return `${fmtEtTime(m.lockTs)} to ${fmtEtTime(m.settleTs)} ET, ${fmtEtDay(m.lockTs)}`;
}

/** The session line on the share card, without the day for hourly markets. */
export function sessionLabel(m: MarketView): string {
  if (m.kind === "daily") return fmtSessionDate(m.sessionId);
  return `${fmtEtTime(m.lockTs)} to ${fmtEtTime(m.settleTs)} ET`;
}

/**
 * Share card data for a position with a final result: a claimed win or
 * refund, or a loss. Null for anything still open or still to be claimed.
 */
export function cardDataOf(row: PositionRow): PnlCardData | null {
  if (row.pnl === null) return null;
  const outcome = outcomeOf(row);
  let final: PnlCardData["outcome"];
  if (outcome === "lost") final = "lost";
  else if (outcome === "claimed") final = row.market.state === "voided" ? "refund" : "won";
  else return null;
  const stake = row.position.amount;
  return {
    symbol: row.market.symbol,
    tier: row.market.tier,
    strikeBps: row.market.strikeBps,
    side: row.position.side,
    stake,
    payout: final === "lost" ? 0n : stake + row.pnl,
    kind: row.market.kind,
    sessionLabel: sessionLabel(row.market),
    outcome: final,
  };
}
