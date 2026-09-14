"use client";

// =============================================================================
// Trading page
// =============================================================================
//
// The board. Live prices across the top, then every market the program
// holds, grouped into ladders and sessions and filtered by where it is in
// its life. All of it is read from chain on a short poll; nothing here comes
// from a server of ours.

import { useMemo, useState } from "react";
import { CalendarClock, Layers, RefreshCw } from "lucide-react";

import { sessionStatus } from "@/lib/calendar";
import { TICKERS, type Ticker } from "@/lib/config";
import { groupMarkets, groupTabs, TAB_META, type MarketGroup, type Tab } from "@/lib/groups";
import { phaseOf, type MarketKind } from "@/lib/market";
import { cn } from "@/lib/utils";
import { useMarkets } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { usePriceFeeds } from "@/hooks/usePriceFeeds";

import {
  Badge,
  Countdown,
  EmptyState,
  SegmentedControl,
  Skeleton,
} from "@/components/ui/primitives";
import HourlyStrip from "./HourlyStrip";
import HowItWorks from "./HowItWorks";
import LadderGroup from "./LadderGroup";
import TickerStrip from "./TickerStrip";

type KindFilter = MarketKind | "all";

function tabSorter(tab: Tab) {
  return (a: MarketGroup, b: MarketGroup) => {
    if (tab === "resolved") return b.settleTs - a.settleTs;
    if (tab === "live") return a.settleTs - b.settleTs;
    return a.lockTs - b.lockTs;
  };
}

export default function TradingPage() {
  const now = useNow();
  const markets = useMarkets();
  const feeds = usePriceFeeds();

  // Null until the visitor picks a tab; before that the board opens on the
  // first tab that has something in it.
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [ticker, setTicker] = useState<Ticker | "all">("all");
  const [kind, setKind] = useState<KindFilter>("all");

  const groups = useMemo(() => groupMarkets(markets.data ?? []), [markets.data]);

  // Per-tab counts, in markets rather than groups, so the numbers match
  // what the chain holds.
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, live: 0, resolved: 0 };
    if (!now) return c;
    for (const m of markets.data ?? []) {
      const phase = phaseOf(m, now);
      if (phase === "deposits" || phase === "awaiting-lock") c.open++;
      else if (phase === "live" || phase === "awaiting-settle") c.live++;
      else c.resolved++;
    }
    return c;
  }, [markets.data, now]);

  const tab: Tab =
    chosenTab ?? (counts.open > 0 ? "open" : counts.live > 0 ? "live" : counts.resolved > 0 ? "resolved" : "open");

  const visible = useMemo(() => {
    if (!now) return [];
    return groups
      .filter((g) => groupTabs(g, now).has(tab))
      .filter((g) => ticker === "all" || g.symbol === ticker)
      .filter((g) => kind === "all" || g.kind === kind)
      .sort(tabSorter(tab));
  }, [groups, now, tab, ticker, kind]);

  const status = now ? sessionStatus(new Date(now * 1000)) : null;
  const loading = markets.isLoading && !markets.data;
  const nothingAtAll = !loading && (markets.data?.length ?? 0) === 0;

  return (
    <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-5 sm:py-7 flex flex-col gap-5">
      {/* Title row */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] font-semibold tracking-tight text-text-1">
            Markets
          </h1>
          <p className="mt-1 text-[13px] text-text-3 max-w-xl">
            Every listed stock, three thresholds, one question each: will it move more than this?
          </p>
        </div>
        {status && (
          <div className="flex items-center gap-2.5 font-mono text-[10.5px] tabular text-text-3">
            <Badge tone={status.open ? "brand" : "neutral"} dot pulse={status.open}>
              {status.label}
            </Badge>
            <span className="hidden sm:inline">
              {status.nextLabel}
              <span className="text-text-4"> · </span>
              <Countdown to={status.nextTs} className="text-text-2" />
            </span>
          </div>
        )}
      </div>

      <TickerStrip
        feeds={feeds.data}
        markets={markets.data ?? []}
        now={now}
        selected={ticker}
        onSelect={setTicker}
      />

      <HowItWorks key={nothingAtAll ? "open" : "closed"} defaultOpen={nothingAtAll} />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={(["open", "live", "resolved"] as Tab[]).map((t) => ({
            value: t,
            label: TAB_META[t].label,
            count: counts[t],
          }))}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            size="sm"
            value={ticker}
            onChange={setTicker}
            options={[
              { value: "all" as const, label: "All" },
              ...TICKERS.map((t) => ({ value: t, label: t })),
            ]}
          />
          <SegmentedControl
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Any" },
              { value: "daily", label: "Daily" },
              { value: "hourly", label: "Hourly" },
            ]}
          />
          <button
            type="button"
            onClick={() => void markets.refetch()}
            className={cn(
              "h-7 w-7 inline-flex items-center justify-center rounded border border-line-1 text-text-3 hover:text-text-1 hover:bg-white/[0.04] transition-colors",
              markets.isFetching && "text-brand",
            )}
            title="Refresh from chain"
            aria-label="Refresh"
          >
            <RefreshCw size={12} className={cn(markets.isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Board */}
      {loading || !now ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-56" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
          <Skeleton className="h-6 w-40 mt-2" />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      ) : markets.isError ? (
        <div className="surface">
          <EmptyState
            icon={<Layers size={18} />}
            title="Could not reach the chain"
            body="The RPC endpoint did not answer. The board refreshes on its own; you can also retry now."
            action={
              <button
                type="button"
                onClick={() => void markets.refetch()}
                className="h-9 px-3 rounded-md border border-line-2 text-[12.5px] text-text-1 hover:bg-white/[0.04]"
              >
                Retry
              </button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<CalendarClock size={18} />}
            title={TAB_META[tab].empty}
            body={
              status ? (
                <span className="flex flex-col items-center gap-2">
                  <span>
                    Hourly markets post at 09:00 ET on trading days, the next daily ladder at 15:55 ET.
                  </span>
                  <span className="font-mono text-[11px] tabular text-text-2">
                    {status.nextLabel}
                    <span className="text-text-4"> · </span>
                    <Countdown to={status.nextTs} className="text-brand" />
                  </span>
                </span>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {visible.map((g) =>
            g.kind === "daily" ? (
              <LadderGroup key={g.id} group={g} now={now} feed={feeds.data?.[g.symbol]} />
            ) : (
              <HourlyStrip key={g.id} group={g} now={now} feed={feeds.data?.[g.symbol]} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
