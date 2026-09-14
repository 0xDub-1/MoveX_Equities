"use client";

// =============================================================================
// Market page
// =============================================================================
//
// One market, read live from chain: the gauge, the pools, the samples the
// threshold came from, the timeline, the ladder it belongs to, and the trade
// panel. Everything is derived from MarketView and the live feed; the page
// holds no state of its own beyond what the hooks cache.

import { useMemo } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { ChevronLeft, SearchX } from "lucide-react";

import { phaseOf } from "@/lib/market";
import { useMarket, useMarkets } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { usePriceFeed } from "@/hooks/usePriceFeeds";
import { EmptyState, SectionHeader, Skeleton, Surface } from "@/components/ui/primitives";

import DepositPanel from "./DepositPanel";
import LadderSiblings from "./LadderSiblings";
import MarketDetails from "./MarketDetails";
import MarketHeader from "./MarketHeader";
import MarketTimeline from "./MarketTimeline";
import PhaseBadge from "./PhaseBadge";
import PoolsPanel from "./PoolsPanel";
import PricePanel from "./PricePanel";
import ThresholdPanel from "./ThresholdPanel";
import { ladderRungs, siblingsOf } from "./helpers";

const CONTAINER = "w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-8";
const GRID =
  "grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px] lg:items-start";

function isAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function BackLink() {
  return (
    <Link
      href="/trading"
      className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3 transition-colors hover:text-text-1"
    >
      <ChevronLeft size={13} />
      Trading
    </Link>
  );
}

function BackButton() {
  return (
    <Link
      href="/trading"
      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line-2 bg-white/[0.04] px-4 text-[13px] font-semibold text-text-1 transition-colors hover:border-line-3 hover:bg-white/[0.07]"
    >
      <ChevronLeft size={14} />
      Back to trading
    </Link>
  );
}

function PageSkeleton() {
  return (
    <div className={CONTAINER}>
      <BackLink />
      <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-8">
          <Skeleton className="h-12 w-24" />
          <Skeleton className="h-12 w-32" />
        </div>
      </div>
      <div className={`mt-6 ${GRID}`}>
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[460px]" />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className={CONTAINER}>
      <BackLink />
      <Surface className="mt-5">
        <EmptyState
          icon={<SearchX size={18} />}
          title="Market not found"
          body="No market lives at this address on devnet."
          action={<BackButton />}
        />
      </Surface>
    </div>
  );
}

function Unavailable() {
  return (
    <div className={CONTAINER}>
      <BackLink />
      <Surface className="mt-5">
        <EmptyState
          title="Market unavailable"
          body="The market could not be read from devnet. The page keeps retrying on its own."
          action={<BackButton />}
        />
      </Surface>
    </div>
  );
}

export default function MarketPage({ address }: { address: string }) {
  const valid = useMemo(() => isAddress(address), [address]);
  const now = useNow();
  const { data: market, isLoading, isError } = useMarket(valid ? address : undefined);
  const { data: markets } = useMarkets();
  const feed = usePriceFeed(market?.symbol);

  // The list may hold a staler copy of this market than the detail query
  // does, so the current market always speaks for itself in its group.
  const siblings = useMemo(
    () => (market ? siblingsOf(market, markets).map((m) => (m.key === market.key ? market : m)) : []),
    [market, markets],
  );
  const rungs = useMemo(
    () => (market ? ladderRungs(market, markets).map((m) => ({ tier: m.tier, strikeBps: m.strikeBps })) : []),
    [market, markets],
  );

  if (!valid || market === null) return <NotFound />;
  if (market === undefined) return isError && !isLoading ? <Unavailable /> : <PageSkeleton />;
  if (!now) return <PageSkeleton />;

  const phase = phaseOf(market, now);

  return (
    <div className={CONTAINER}>
      <BackLink />

      <div className="mt-5">
        <MarketHeader market={market} phase={phase} />
      </div>

      {/*
        Below lg the left column dissolves (display: contents) so the gauge,
        the trade panel and the rest can be ordered as grid items; from lg up
        it is one flex column beside the sticky panel.
      */}
      <div className={`mt-6 sm:mt-8 ${GRID}`}>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="order-1 min-w-0 lg:order-none">
            <PricePanel market={market} phase={phase} feed={feed} now={now} rungs={rungs} />
          </div>
          <div className="order-3 flex min-w-0 flex-col gap-4 lg:order-none">
            <PoolsPanel market={market} />
            <ThresholdPanel market={market} rungs={rungs} />
            <MarketTimeline market={market} phase={phase} />
            <LadderSiblings market={market} siblings={siblings} now={now} />
            <MarketDetails market={market} />
          </div>
        </div>

        <Surface className="order-2 lg:order-none lg:sticky lg:top-[72px] lg:self-start">
          <SectionHeader label="Trade" trailing={<PhaseBadge phase={phase} />} />
          <DepositPanel market={market} phase={phase} now={now} feed={feed} />
        </Surface>
      </div>
    </div>
  );
}
