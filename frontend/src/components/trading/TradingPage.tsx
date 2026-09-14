"use client";

// =============================================================================
// Trading page
// =============================================================================
//
// The board: every market the program holds, grouped into daily ladders and
// hourly sessions and filtered by where it is in its life. All of it is read
// from chain on a short poll; nothing here comes from a server of ours.

import { useMemo, useState } from "react";
import { CalendarClock, Layers, RefreshCw } from "lucide-react";

import { nextPostTs, sessionStatus } from "@/lib/calendar";
import { TICKERS, type Ticker } from "@/lib/config";
import { groupMarkets, tabOf, TAB_META, type MarketGroup, type Tab } from "@/lib/groups";
import { phaseOf, pot, type MarketKind } from "@/lib/market";
import { fmtUsdx } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMarkets } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { usePriceFeeds } from "@/hooks/usePriceFeeds";

import { Badge, Countdown, EmptyState, SegmentedControl, Skeleton } from "@/components/ui/primitives";
import HourlySession from "./HourlySession";
import HowItWorks from "./HowItWorks";
import LadderGroup from "./LadderGroup";
import HourlyCountdown from "./HourlyCountdown";

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

  // Every filter applies to markets, never to groups. A group is only the
  // way matching markets are laid out, so a session with one settled hour
  // shows that hour under Resolved rather than all six.
  const selected = useMemo(() => {
    if (!markets.data) return [];
    return markets.data.filter(
      (m) => (ticker === "all" || m.symbol === ticker) && (kind === "all" || m.kind === kind),
    );
  }, [markets.data, ticker, kind]);

  // Counted after the ticker and kind filters, so each tab's number is what
  // that tab will actually show.
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, live: 0, resolved: 0 };
    if (!now) return c;
    for (const m of selected) c[tabOf(phaseOf(m, now))]++;
    return c;
  }, [selected, now]);

  const tab: Tab =
    chosenTab ??
    (counts.open > 0 ? "open" : counts.live > 0 ? "live" : counts.resolved > 0 ? "resolved" : "open");

  const visible = useMemo(() => {
    if (!now) return [];
    return groupMarkets(selected.filter((m) => tabOf(phaseOf(m, now)) === tab)).sort(tabSorter(tab));
  }, [selected, now, tab]);

  // What the visible board adds up to, so the page says something at a glance.
  const totals = useMemo(() => {
    const all = visible.flatMap((g) => g.markets);
    return { markets: all.length, pot: all.reduce((sum, m) => sum + pot(m), 0n) };
  }, [visible]);

  const status = now ? sessionStatus(new Date(now * 1000)) : null;
  const loading = markets.isLoading && !markets.data;
  const nothingAtAll = !loading && (markets.data?.length ?? 0) === 0;

  // When the board next gains anything: 15:55 ET, the daily ladder and the
  // following session's hours together.
  const postTs = useMemo(() => {
    if (!now) return null;
    try {
      return nextPostTs(new Date(now * 1000));
    } catch {
      // The calendar does not cover the year ahead.
      return null;
    }
  }, [now]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      {/* Title */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-text-1 sm:text-[30px]">
            Markets
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-2">
            Every listed stock carries three thresholds, and each one is its own market with a single
            question: will it move more than this, in either direction?
          </p>
        </div>
        {status && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] tabular text-text-3">
            <Badge tone={status.open ? "brand" : "neutral"} dot pulse={status.open}>
              {status.label}
            </Badge>
            <span className="hidden sm:inline">
              {status.nextLabel}
              <span className="text-text-4"> · </span>
              <Countdown to={status.nextTs} className="text-text-1" />
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-11" />
      ) : (
        <HourlyCountdown markets={markets.data ?? []} now={now} />
      )}

      <HowItWorks key={nothingAtAll ? "open" : "closed"} defaultOpen={nothingAtAll} />

      {/* Filters */}
      <div className="flex flex-col gap-3 border-y border-line-1 py-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={(["open", "live", "resolved"] as Tab[]).map((t) => ({
            value: t,
            label: TAB_META[t].label,
            count: counts[t],
          }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          {!loading && totals.markets > 0 && (
            <span className="mr-1 hidden font-mono text-[12px] tabular text-text-3 xl:inline">
              {totals.markets} markets ·{" "}
              <span className="text-text-1">{fmtUsdx(totals.pot, { compact: true })}</span> USDX
            </span>
          )}
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
              "inline-flex h-7 w-7 items-center justify-center rounded border border-line-1 text-text-3 transition-colors hover:bg-white/[0.04] hover:text-text-1",
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
        <div className="flex flex-col gap-8">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3.5">
              <Skeleton className="h-6 w-64" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Skeleton className="h-[248px]" />
                <Skeleton className="h-[248px]" />
                <Skeleton className="h-[248px]" />
              </div>
            </div>
          ))}
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
                className="h-9 rounded-md border border-line-2 px-3 text-[12.5px] text-text-1 hover:bg-white/[0.04]"
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
              <span className="flex flex-col items-center gap-2">
                <span>
                  Markets for the next session post at 15:55 ET, the daily ladder and that
                  session&apos;s intraday hours together.
                </span>
                {postTs && (
                  <span className="font-mono text-[12px] tabular text-text-2">
                    Next posting in <Countdown to={postTs} className="text-brand" />
                  </span>
                )}
              </span>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-9">
          {visible.map((g) =>
            g.kind === "daily" ? (
              <LadderGroup key={g.id} group={g} now={now} feed={feeds.data?.[g.symbol]} />
            ) : (
              <HourlySession key={g.id} group={g} now={now} feed={feeds.data?.[g.symbol]} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
