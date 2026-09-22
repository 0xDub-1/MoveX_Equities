"use client";

// =============================================================================
// Trading page
// =============================================================================
//
// The board of one venue. One choice at the top, hours or days; under it the
// question that instrument asks, stated once; then the lifecycle and asset
// controls; then one group per asset, each with its overview strip and its
// cards. All of it is read from chain on a short poll; nothing here comes
// from a server of ours.
//
// Equities and crypto share this page and differ only in the clock and the
// nouns, all of which come from the venue rather than being assumed.

import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, Layers } from "lucide-react";

import { assetsOf } from "@/lib/assets";
import { HOURLY_POST_MINUTES, fmtPostTime, nextPostTs, sessionStatus } from "@/lib/calendar";
import { cryptoStatus } from "@/lib/clock";
import { LEDE_COPY, STAGE_META, emptyCopy, stageOf, type Instrument, type Stage } from "@/lib/board";
import { fmtUsdx } from "@/lib/format";
import { pot, type MarketView } from "@/lib/market";
import { nextEvent } from "@/lib/upcoming";
import { cn } from "@/lib/utils";
import { VENUES, type Venue } from "@/lib/venue";
import { useVenueMarkets } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { usePriceFeeds } from "@/hooks/usePriceFeeds";

import { Badge, Countdown, EmptyState } from "@/components/ui/primitives";
import AssetGroup from "./AssetGroup";
import BoardSkeleton from "./BoardSkeleton";
import BoardToolbar from "./BoardToolbar";
import HowItWorks from "./HowItWorks";
import InstrumentTabs from "./InstrumentTabs";

const EMPTY_STAGES: Record<Stage, number> = { open: 0, live: 0, resolved: 0 };

function countStages(markets: readonly MarketView[], now: number): Record<Stage, number> {
  const c = { ...EMPTY_STAGES };
  for (const m of markets) c[stageOf(m, now)]++;
  return c;
}

/** The first stage with something in it, open first. */
function firstStage(counts: Record<Stage, number>): Stage {
  if (counts.open > 0) return "open";
  if (counts.live > 0) return "live";
  if (counts.resolved > 0) return "resolved";
  return "open";
}

export default function TradingPage({ venue }: { venue: Venue }) {
  const meta = VENUES[venue];
  const now = useNow();
  const markets = useVenueMarkets(venue);
  const feeds = usePriceFeeds();
  const registry = useMemo(() => assetsOf(venue).map((a) => a.symbol), [venue]);

  // -- choices ---------------------------------------------------------------
  const [chosenInstrument, setInstrument] = useState<Instrument | null>(null);
  const [chosenStage, setChosenStage] = useState<Record<Instrument, Stage | null>>({ hourly: null, daily: null });
  const [asset, setAsset] = useState<string>("all");
  const [howOpen, setHowOpen] = useState(false);

  const all = useMemo(() => markets.data ?? [], [markets.data]);
  const byKind = useMemo(
    () => ({
      hourly: all.filter((m) => m.kind === "hourly"),
      daily: all.filter((m) => m.kind === "daily"),
    }),
    [all],
  );

  // Until the reader picks, the board opens on Hourly whenever an hour is in
  // play and on Daily otherwise, so a first paint never lands on an empty
  // tab. A reader's own choice always wins over the default.
  const defaultInstrument: Instrument = useMemo(() => {
    if (!markets.data || !now) return "hourly";
    const hourly = countStages(byKind.hourly, now);
    const daily = countStages(byKind.daily, now);
    return hourly.open + hourly.live === 0 && daily.open + daily.live + daily.resolved > 0 ? "daily" : "hourly";
  }, [markets.data, byKind, now]);
  const instrument: Instrument = chosenInstrument ?? defaultInstrument;

  // Tab chips count what is in play per instrument, across every asset.
  const tabCounts = useMemo(() => {
    const of = (list: MarketView[]) => {
      const c = now ? countStages(list, now) : EMPTY_STAGES;
      return { inPlay: c.open + c.live, live: c.live > 0 };
    };
    return { hourly: of(byKind.hourly), daily: of(byKind.daily) };
  }, [byKind, now]);

  // The instrument's markets, narrowed by asset.
  const ofInstrument = byKind[instrument];
  const assetsHere = useMemo(
    () => registry.filter((s) => ofInstrument.some((m) => m.symbol === s)),
    [registry, ofInstrument],
  );
  const effectiveAsset = assetsHere.includes(asset) ? asset : "all";
  const selected = useMemo(
    () => (effectiveAsset === "all" ? ofInstrument : ofInstrument.filter((m) => m.symbol === effectiveAsset)),
    [ofInstrument, effectiveAsset],
  );

  const stageCounts = useMemo(() => (now ? countStages(selected, now) : EMPTY_STAGES), [selected, now]);
  // A chosen stage that has emptied out, because its last hour locked or the
  // asset changed under it, gives way to one with something in it rather than
  // leaving the reader on a blank panel.
  const chosen = chosenStage[instrument];
  const stage: Stage = chosen && stageCounts[chosen] > 0 ? chosen : firstStage(stageCounts);
  const shown = useMemo(() => (now ? selected.filter((m) => stageOf(m, now) === stage) : []), [selected, stage, now]);

  // One group per asset. Open and Live in registry order; Settled with the
  // most recently settled asset first.
  const groups = useMemo(() => {
    const symbols = registry.filter((s) => shown.some((m) => m.symbol === s));
    if (stage === "resolved") {
      const latest = (s: string) => Math.max(...shown.filter((m) => m.symbol === s).map((m) => m.settleTs));
      symbols.sort((a, b) => latest(b) - latest(a));
    }
    return symbols.map((s) => ({
      symbol: s,
      all: ofInstrument.filter((m) => m.symbol === s),
      shown: shown.filter((m) => m.symbol === s),
    }));
  }, [registry, shown, ofInstrument, stage]);

  const totals = useMemo(
    () => ({ markets: shown.length, pot: shown.reduce((sum, m) => sum + pot(m), 0n) }),
    [shown],
  );

  // -- header ----------------------------------------------------------------
  const status = now ? (venue === "equities" ? sessionStatus(new Date(now * 1000)) : cryptoStatus(new Date(now * 1000))) : null;
  const upcoming = useMemo(() => (now ? nextEvent(all, now) : null), [all, now]);
  const postTs = useMemo(() => {
    if (!now || venue !== "equities") return null;
    try {
      return nextPostTs(new Date(now * 1000), HOURLY_POST_MINUTES);
    } catch {
      return null;
    }
  }, [now, venue]);

  const loading = (markets.isLoading && !markets.data) || !now;
  const nothingAtAll = !loading && all.length === 0;
  const empty = !loading && !markets.isError && shown.length === 0;
  const emptyText = empty && now ? emptyCopy(venue, instrument, stage, now) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col px-4 sm:px-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 py-6 md:flex-row md:items-end md:justify-between sm:py-8">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-text-1 sm:text-[30px]">
            {meta.label}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-2">{meta.tagline}</p>
        </div>
        {status && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[12px] tabular text-text-3">
            <Badge tone={status.open ? "brand" : "neutral"} dot pulse={status.open}>
              {status.label}
            </Badge>
            {upcoming ? (
              <span>
                Next <span className="text-text-4">·</span> <span className="text-text-2">{upcoming.label}</span>{" "}
                {upcoming.kind === "lock" ? "locks in" : "settles in"}{" "}
                <Countdown to={upcoming.ts} className="text-text-1" />
              </span>
            ) : postTs ? (
              <span>
                Next <span className="text-text-4">·</span> hours post at {fmtPostTime(HOURLY_POST_MINUTES)} ET in{" "}
                <Countdown to={postTs} className="text-text-1" />
              </span>
            ) : venue === "crypto" && !loading ? (
              <span>
                Next <span className="text-text-4">·</span> the next hour is posted within minutes
              </span>
            ) : null}
          </div>
        )}
      </div>

      <InstrumentTabs value={instrument} onChange={setInstrument} venue={venue} counts={tabCounts} />

      {/* Instrument lede */}
      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0 max-w-3xl">
          <p className="text-[13.5px] leading-relaxed text-text-2">{LEDE_COPY[venue][instrument]}</p>
          <button
            type="button"
            onClick={() => setHowOpen((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-text-3 transition-colors hover:text-text-1"
            aria-expanded={howOpen || nothingAtAll}
          >
            How it works
            <ChevronDown size={13} className={cn("transition-transform", (howOpen || nothingAtAll) && "rotate-180")} />
          </button>
        </div>
        {!loading && totals.markets > 0 && (
          <p className="shrink-0 font-mono text-[12px] tabular text-text-3">
            {/* The stage is named because the figure counts only that stage,
                which is what makes it agree with the asset rows below. */}
            <span className="whitespace-nowrap">
              {STAGE_META[stage].label} <span className="text-text-4">·</span>
            </span>{" "}
            <span className="whitespace-nowrap">
              {totals.markets} market{totals.markets === 1 ? "" : "s"} <span className="text-text-4">·</span>
            </span>{" "}
            <span className="whitespace-nowrap">
              <span className="text-text-1">{fmtUsdx(totals.pot, { compact: true })}</span> USDX
            </span>
          </p>
        )}
      </div>

      {(howOpen || nothingAtAll) && (
        <div className="mt-4">
          <HowItWorks venue={venue} />
        </div>
      )}

      <div className="mt-4">
        <BoardToolbar
          stage={stage}
          onStage={(s) => setChosenStage((prev) => ({ ...prev, [instrument]: s }))}
          stageCounts={stageCounts}
          asset={effectiveAsset}
          onAsset={setAsset}
          assets={assetsHere}
          refreshing={markets.isFetching}
          onRefresh={() => void markets.refetch()}
        />
      </div>

      {/* Board */}
      <div className="py-6">
        {loading ? (
          <BoardSkeleton />
        ) : markets.isError && !markets.data ? (
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
        ) : empty && emptyText ? (
          <div className="surface">
            <EmptyState
              icon={<CalendarClock size={18} />}
              title={emptyText.title}
              body={
                <span className="flex flex-col items-center gap-2">
                  <span>{emptyText.body}</span>
                  {emptyText.untilTs && emptyText.untilTs > now && (
                    <span className="font-mono text-[12px] tabular text-text-2">
                      {emptyText.untilLabel} <Countdown to={emptyText.untilTs} className="text-brand" />
                    </span>
                  )}
                </span>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map((g) => (
              <AssetGroup
                key={`${instrument}-${g.symbol}`}
                symbol={g.symbol}
                kind={instrument}
                all={g.all}
                shown={g.shown}
                stage={stage}
                now={now}
                feed={feeds.data?.[g.symbol]}
                onStage={(s) => setChosenStage((prev) => ({ ...prev, [instrument]: s }))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
