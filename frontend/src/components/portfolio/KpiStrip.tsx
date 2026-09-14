"use client";

// =============================================================================
// KPI strip
// =============================================================================
//
// Four totals across every position: what is still open, what is locked in,
// what can be collected, and what has already been won or lost.

import { fmtUsdx, fmtUsdxSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton, Stat, Surface } from "@/components/ui/primitives";

import type { PositionRow } from "./rows";

export interface Kpis {
  /** Stakes in markets still taking deposits or waiting to lock. */
  open: bigint;
  /** Stakes locked in and riding to settlement. */
  live: bigint;
  claimable: bigint;
  /** Realised result across resolved markets. */
  realized: bigint;
  resolved: number;
}

export function computeKpis(rows: PositionRow[]): Kpis {
  const k: Kpis = { open: 0n, live: 0n, claimable: 0n, realized: 0n, resolved: 0 };
  for (const { phase, position, claimable, pnl } of rows) {
    if (phase === "deposits" || phase === "awaiting-lock") k.open += position.amount;
    else if (phase === "live" || phase === "awaiting-settle") k.live += position.amount;
    k.claimable += claimable;
    if (pnl !== null) {
      k.realized += pnl;
      k.resolved += 1;
    }
  }
  return k;
}

/** Hairlines between cells: a 2 by 2 grid below lg, one row of four above. */
const CELL_BORDERS = [
  "",
  "border-l border-line-1",
  "border-t border-line-1 lg:border-l lg:border-t-0",
  "border-l border-t border-line-1 lg:border-t-0",
];

function Unit() {
  return <span className="ml-1 font-sans text-[12px] font-medium text-text-4">USDX</span>;
}

function CellSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-7 w-32 max-w-full" />
      <Skeleton className="h-2.5 w-28 max-w-full" />
    </div>
  );
}

export default function KpiStrip({ kpis, loading }: { kpis: Kpis; loading: boolean }) {
  const realizedTone =
    kpis.realized > 0n ? "text-brand" : kpis.realized < 0n ? "text-loss" : undefined;

  const cells: { label: string; value: string; sub: string; tone?: string }[] = [
    { label: "In open markets", value: fmtUsdx(kpis.open), sub: "Deposits open or locking" },
    { label: "Live exposure", value: fmtUsdx(kpis.live), sub: "Locked, riding to settlement" },
    {
      label: "Claimable",
      value: fmtUsdx(kpis.claimable),
      sub: "Ready to collect",
      tone: kpis.claimable > 0n ? "text-brand" : undefined,
    },
    {
      label: "Realized P&L",
      value: fmtUsdxSigned(kpis.realized),
      sub: `${kpis.resolved} resolved position${kpis.resolved === 1 ? "" : "s"}`,
      tone: realizedTone,
    },
  ];

  return (
    <Surface as="section">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {cells.map((cell, i) => (
          <div key={cell.label} className={cn("px-4 py-4 sm:px-5", CELL_BORDERS[i])}>
            {loading ? (
              <CellSkeleton />
            ) : (
              <Stat
                label={cell.label}
                size="lg"
                valueClassName={cn("text-[22px] sm:text-3xl", cell.tone)}
                value={
                  <>
                    {cell.value}
                    <Unit />
                  </>
                }
                sub={cell.sub}
              />
            )}
          </div>
        ))}
      </div>
    </Surface>
  );
}
