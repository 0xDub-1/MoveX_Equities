"use client";

// =============================================================================
// Trading page
// =============================================================================
//
// The board of one venue: every market on it, grouped into daily ladders and
// hourly sessions and filtered by where it is in its life. All of it is read
// from chain on a short poll; nothing here comes from a server of ours.
//
// Equities and crypto share the board and differ in the clock and the copy.
// Everything that differs comes from the venue rather than being assumed.

import { useMemo, useState } from "react";
import { CalendarClock, Layers, RefreshCw } from "lucide-react";

import { assetsOf } from "@/lib/assets";
import {
  DAILY_POST_MINUTES,
  HOURLY_POST_MINUTES,
  fmtPostTime,
  nextPostTs,
  sessionStatus,
} from "@/lib/calendar";
import { cryptoStatus } from "@/lib/clock";
import { groupMarkets, tabOf, TAB_META, type MarketGroup, type Tab } from "@/lib/groups";
import { phaseOf, pot, type MarketKind } from "@/lib/market";
import { fmtUsdx } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VENUES, type Venue } from "@/lib/venue";
import { useVenueMarkets } from "@/hooks/useMarkets";
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

export default function TradingPage({ venue }: { venue: Venue }) {
  const meta = VENUES[venue];
  const assets = useMemo(() => assetsOf(venue), [venue]);
  const now = useNow();
  const markets = useVenueMarkets(venue);
  const feeds = usePriceFeeds();

  // Null until the visitor picks a tab; before that the board opens on the
  // first tab that has something in it.
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [ticker, setTicker] = useState<string>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  // Every filter applies to markets, never to groups. A group is only the
  // way matching markets are laid out, so a session with one settled hour
  // shows that hour under Resolved rather than all of them.
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

  const status = now
    ? venue === "equities"
      ? sessionStatus(new Date(now * 1000))
      : cryptoStatus(new Date(now * 1000))
    : null;
  const loading = markets.isLoading && !markets.data;
  const nothingAtAll = !loading && (markets.data?.length ?? 0) === 0;

  // When the equities board next gains anything. The two kinds are posted at
  // different hours, so this is whichever comes first. Crypto posts around
  // the clock and never waits for an evening.
  const postTs = useMemo(() => {
    if (!now || venue !== "equities") return null;
    try {
      const at = new Date(now * 1000);
      return Math.min(nextPostTs(at, DAILY_POST_MINUTES), nextPostTs(at, HOURLY_POST_MINUTES));
    } catch {
      // The calendar does not cover the year ahead.
      return null;
    }
  }, [now, venue]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      {/* Title */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-text-1 sm:text-[30px]">
            {meta.label}
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-2">{meta.tagline}</p>
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
        <HourlyCountdown markets={markets.data ?? []} now={now} venue={venue} />
      )}

      <HowItWorks key={`${venue}-${nothingAtAll ? "open" : "closed"}`} defaultOpen={nothingAtAll} venue={venue} />

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
              { value: "all", label: "All" },
              ...assets.map((a) => ({ value: a.symbol, label: a.symbol })),
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
              venue === "crypto" ? (
                <span>
                  Hourly markets are posted four hours ahead and the daily ladder a day ahead, around
                  the clock. An empty board means the keeper is catching up; it repairs itself within
                  ten minutes.
                </span>
              ) : (
                <span className="flex flex-col items-center gap-2">
                  <span>
                    The daily ladder is posted at {fmtPostTime(DAILY_POST_MINUTES)} ET and the next
                    session&apos;s intraday hours at {fmtPostTime(HOURLY_POST_MINUTES)} ET.
                  </span>
                  {postTs && (
                    <span className="font-mono text-[12px] tabular text-text-2">
                      Next posting in <Countdown to={postTs} className="text-brand" />
                    </span>
                  )}
                </span>
              )
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
