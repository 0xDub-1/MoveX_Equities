"use client";

// =============================================================================
// Positions table
// =============================================================================
//
// Every position the wallet holds, in three tabs: what is running, what can
// be claimed, and what is done. A real table from md up; stacked cards below
// it, since six columns do not survive a phone.

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Coins, History, Layers, RefreshCw, Share2 } from "lucide-react";

import { fmtBps, fmtMultiple, fmtUsdx, fmtUsdxSigned } from "@/lib/format";
import { PHASE_META, payoutMultiple, type MarketView } from "@/lib/market";
import type { PnlCardData } from "@/lib/pnl-card";
import { cn } from "@/lib/utils";
import { isFeedFresh, type PriceFeeds } from "@/hooks/usePriceFeeds";
import MoveMeter from "@/components/trading/MoveMeter";
import {
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  SectionHeader,
  SegmentedControl,
  SideTag,
  Skeleton,
  Surface,
  TierTag,
} from "@/components/ui/primitives";

import LinkButton from "./LinkButton";
import PnlShareModal from "./PnlShareModal";
import WithdrawModal from "./WithdrawModal";
import {
  OUTCOME_META,
  cardDataOf,
  filterRows,
  outcomeOf,
  windowLabel,
  type MarketActions,
  type PositionRow,
  type Tab,
} from "./rows";

interface Props {
  rows: PositionRow[];
  loading: boolean;
  error: boolean;
  retrying: boolean;
  onRetry: () => void;
  feeds: PriceFeeds | undefined;
  now: number;
  actions: MarketActions;
}

const EMPTY: Record<Tab, { icon: ReactNode; title: string; body: string }> = {
  active: {
    icon: <Layers size={16} />,
    title: "No active positions",
    body: "Open a market on the trading page and pick a side.",
  },
  claimable: {
    icon: <Coins size={16} />,
    title: "Nothing to claim",
    body: "Winning and refunded positions appear here once their market resolves.",
  },
  history: {
    icon: <History size={16} />,
    title: "No history yet",
    body: "Resolved positions, claimed or lost, are kept here.",
  },
};

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function MarketCell({ market }: { market: MarketView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[15px] font-semibold tracking-tight text-text-1">
          {market.symbol}
        </span>
        <TierTag tier={market.tier} className="h-5 px-1.5 text-[10.5px]" />
        <span className="font-mono text-[11px] tabular text-text-2">{fmtBps(market.strikeBps)}</span>
        <Eyebrow size="sm" className="text-text-4">
          {market.kind}
        </Eyebrow>
      </div>
      <span className="font-mono text-[11px] tabular text-text-3">{windowLabel(market)}</span>
    </div>
  );
}

function Stake({ amount }: { amount: bigint }) {
  return (
    <span className="font-mono text-[12.5px] tabular text-text-1">
      {fmtUsdx(amount)} <span className="text-text-4">USDX</span>
    </span>
  );
}

function StatusBadge({ row }: { row: PositionRow }) {
  const outcome = outcomeOf(row);
  if (outcome) {
    const meta = OUTCOME_META[outcome];
    return <Badge tone={meta.tone}>{meta.label}</Badge>;
  }
  const meta = PHASE_META[row.phase];
  const live = row.phase === "live";
  return (
    <Badge tone={meta.tone} dot={live} pulse={live}>
      {meta.label}
    </Badge>
  );
}

function Standing({
  row,
  feeds,
  now,
}: {
  row: PositionRow;
  feeds: PriceFeeds | undefined;
  now: number;
}) {
  const { market, position, phase, pnl } = row;

  if (phase === "live" || phase === "awaiting-settle") {
    const feed = feeds?.[market.symbol];
    const fresh = isFeedFresh(feed, now);
    return (
      <div
        className="min-w-[180px] max-w-[260px]"
        title={feed && !fresh ? "The oracle print is older than two minutes." : undefined}
      >
        <MoveMeter
          reference={market.referencePrice}
          current={fresh ? feed?.price : undefined}
          strikeBps={market.strikeBps}
        />
      </div>
    );
  }

  if (phase === "deposits" || phase === "awaiting-lock") {
    return (
      <span className="font-mono text-[12px] tabular text-text-1">
        <span className="text-text-4">pays </span>
        {fmtMultiple(payoutMultiple(market, position.side))}
      </span>
    );
  }

  if (pnl === null) return <span className="font-mono text-[12px] text-text-4">--</span>;

  const won = market.state === "settled" && position.side === market.winningSide;
  const tone = pnl > 0n ? "text-brand" : pnl < 0n ? "text-loss" : "text-text-2";
  const note =
    market.state === "voided"
      ? "full refund"
      : won
        ? `paid ${fmtUsdx(position.amount + pnl)}`
        : "stake lost";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-mono text-[12.5px] font-semibold tabular", tone)}>
        {fmtUsdxSigned(pnl)}
      </span>
      <span className="font-mono text-[10.5px] tabular text-text-4">{note}</span>
    </div>
  );
}

function RowActions({
  row,
  actions,
  onWithdraw,
  onShare,
}: {
  row: PositionRow;
  actions: MarketActions;
  onWithdraw: (row: PositionRow) => void;
  onShare: (row: PositionRow) => void;
}) {
  const { market, phase, claimable } = row;
  const shareable = cardDataOf(row) !== null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {phase === "deposits" && (
        <Button
          size="sm"
          variant="secondary"
          disabled={actions.isPending(market, "withdraw")}
          onClick={() => onWithdraw(row)}
        >
          Withdraw
        </Button>
      )}
      {claimable > 0n && (
        <Button
          size="sm"
          variant="primary"
          loading={actions.isPending(market, "claim")}
          onClick={() => void actions.claim(market, claimable)}
        >
          Claim
        </Button>
      )}
      {shareable && (
        <Button size="sm" variant="ghost" onClick={() => onShare(row)}>
          <Share2 size={12} />
          Share
        </Button>
      )}
      <LinkButton href={`/market/${market.key}`} size="sm" variant="ghost">
        View
        <ChevronRight size={12} />
      </LinkButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-text-3",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Field({
  label,
  children,
  align = "left",
  className,
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", align === "right" && "items-end text-right", className)}>
      <Eyebrow size="sm">{label}</Eyebrow>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-16 sm:block" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export default function PositionsTable({
  rows,
  loading,
  error,
  retrying,
  onRetry,
  feeds,
  now,
  actions,
}: Props) {
  const [tab, setTab] = useState<Tab>("active");
  const [withdrawKey, setWithdrawKey] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [shareData, setShareData] = useState<PnlCardData | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const lists = useMemo(
    () => ({
      active: filterRows(rows, "active"),
      claimable: filterRows(rows, "claimable"),
      history: filterRows(rows, "history"),
    }),
    [rows],
  );
  const visible = lists[tab];

  // Looked up by key on every render so the modal follows the live pools.
  const withdrawRow = useMemo(
    () => rows.find((r) => r.position.key === withdrawKey) ?? null,
    [rows, withdrawKey],
  );

  const openWithdraw = (row: PositionRow) => {
    setWithdrawKey(row.position.key);
    setWithdrawOpen(true);
  };

  const openShare = (row: PositionRow) => {
    const data = cardDataOf(row);
    if (!data) return;
    setShareData(data);
    setShareOpen(true);
  };

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "active", label: "Active", count: lists.active.length },
    { value: "claimable", label: "Claimable", count: lists.claimable.length },
    { value: "history", label: "History", count: lists.history.length },
  ];
  const control = <SegmentedControl size="sm" options={tabs} value={tab} onChange={setTab} />;

  let body: ReactNode;
  if (loading) {
    body = <SkeletonRows />;
  } else if (error) {
    body = (
      <EmptyState
        icon={<RefreshCw size={16} />}
        title="Could not read positions"
        body="The RPC did not answer. Try again in a moment."
        action={
          <Button size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    const empty = EMPTY[tab];
    body = (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        body={empty.body}
        action={
          tab === "active" ? (
            <LinkButton href="/trading" size="sm" variant="secondary">
              Browse markets
            </LinkButton>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[840px] border-collapse">
            <thead>
              <tr className="border-b border-line-1">
                <Th className="pl-4 sm:pl-5">Market</Th>
                <Th>Answer</Th>
                <Th className="text-right">Stake</Th>
                <Th>Status</Th>
                <Th className="w-[240px]">Standing</Th>
                <Th className="pr-4 text-right sm:pr-5">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.position.key}
                  className="border-b border-line-1 transition-colors last:border-b-0 hover:bg-white/[0.02]"
                >
                  <td className="py-3 pl-4 pr-3 align-middle sm:pl-5">
                    <MarketCell market={row.market} />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <SideTag side={row.position.side} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right align-middle">
                    <Stake amount={row.position.amount} />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <StatusBadge row={row} />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <Standing row={row} feeds={feeds} now={now} />
                  </td>
                  <td className="py-3 pl-3 pr-4 align-middle sm:pr-5">
                    <RowActions row={row} actions={actions} onWithdraw={openWithdraw} onShare={openShare} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-line-1 md:hidden">
          {visible.map((row) => (
            <div key={row.position.key} className="flex flex-col gap-3.5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <MarketCell market={row.market} />
                <StatusBadge row={row} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Answer">
                  <SideTag side={row.position.side} />
                </Field>
                <Field label="Stake" align="right">
                  <Stake amount={row.position.amount} />
                </Field>
                <Field label="Standing" className="col-span-2">
                  <Standing row={row} feeds={feeds} now={now} />
                </Field>
              </div>
              <RowActions row={row} actions={actions} onWithdraw={openWithdraw} onShare={openShare} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <Surface as="section">
      <SectionHeader
        number="03"
        label="Positions"
        trailing={<div className="hidden sm:block">{control}</div>}
      />
      <div className="overflow-x-auto border-b border-line-1 px-4 py-2.5 sm:hidden">{control}</div>

      {body}

      <WithdrawModal
        key={withdrawKey ?? "none"}
        open={withdrawOpen}
        row={withdrawRow}
        now={now}
        pending={withdrawRow ? actions.isPending(withdrawRow.market, "withdraw") : false}
        onClose={() => setWithdrawOpen(false)}
        onWithdraw={actions.withdraw}
      />
      <PnlShareModal open={shareOpen} data={shareData} onClose={() => setShareOpen(false)} />
    </Surface>
  );
}
