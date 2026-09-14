"use client";

// Development-only gallery of the trading components on fixture data, so
// every phase can be looked at before the keeper has posted a market.

import { useMemo } from "react";

import { fixtureFeeds, fixtureMarkets } from "@/lib/fixtures";
import { groupMarkets } from "@/lib/groups";
import { useNow } from "@/hooks/useNow";

import { SectionHeader, Surface } from "@/components/ui/primitives";
import HourlySession from "./HourlySession";
import LadderGroup from "./LadderGroup";
import MoveGauge from "./MoveGauge";
import SamplesHistogram from "./SamplesHistogram";
import SideSplit from "./SideSplit";
import TickerStrip from "./TickerStrip";

export default function PreviewPage() {
  const now = useNow();
  // Anchored to a ten minute bucket so the fixtures stay put while the
  // countdowns inside them tick.
  const base = Math.floor(now / 600) * 600;
  const markets = useMemo(() => fixtureMarkets(base), [base]);
  const feeds = useMemo(() => fixtureFeeds(base), [base]);
  const groups = useMemo(() => groupMarkets(markets), [markets]);

  if (!now) return null;

  const tsla = markets.filter((m) => m.symbol === "TSLA");
  const tslaFair = tsla.find((m) => m.tier === "fair")!;
  const nvdaFair = markets.find((m) => m.symbol === "NVDA" && m.tier === "fair" && m.kind === "daily")!;
  const spyFair = markets.find((m) => m.symbol === "SPY" && m.tier === "fair")!;
  const siblings = (symbol: string) =>
    markets.filter((m) => m.symbol === symbol && m.kind === "daily").map((m) => ({ tier: m.tier, strikeBps: m.strikeBps }));

  return (
    <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-8">
      <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-warning">
        Preview on fixtures. Development only.
      </p>

      <TickerStrip feeds={feeds} markets={markets} now={now} selected="all" onSelect={() => {}} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Surface>
          <SectionHeader number="01" label="Gauge, live market" />
          <div className="p-5">
            <MoveGauge
              reference={tslaFair.referencePrice}
              current={feeds.TSLA.price}
              strikeBps={tslaFair.strikeBps}
              tier="fair"
              state="locked"
              siblings={siblings("TSLA")}
            />
          </div>
        </Surface>
        <Surface>
          <SectionHeader number="02" label="Gauge, open market (preview)" />
          <div className="p-5">
            <MoveGauge
              reference={0n}
              current={feeds.NVDA.price}
              strikeBps={nvdaFair.strikeBps}
              tier="fair"
              state="open"
              siblings={siblings("NVDA")}
              provisional
            />
          </div>
        </Surface>
        <Surface>
          <SectionHeader number="03" label="Gauge, settled" />
          <div className="p-5">
            <MoveGauge
              reference={spyFair.referencePrice}
              current={spyFair.settlementPrice}
              strikeBps={spyFair.strikeBps}
              tier="fair"
              state="settled"
              winningSide={spyFair.winningSide}
              siblings={siblings("SPY")}
            />
          </div>
        </Surface>
        <Surface>
          <SectionHeader number="04" label="Samples and the two answers" />
          <div className="p-5 flex flex-col gap-6">
            <SamplesHistogram
              samplesBps={nvdaFair.samplesBps}
              strikeBps={nvdaFair.strikeBps}
              tier="fair"
              siblings={siblings("NVDA")}
            />
            <SideSplit market={nvdaFair} size="lg" />
          </div>
        </Surface>
      </div>

      {groups.map((g) =>
        g.kind === "daily" ? (
          <LadderGroup key={g.id} group={g} now={now} feed={feeds[g.symbol]} />
        ) : (
          <HourlySession key={g.id} group={g} now={now} feed={feeds[g.symbol]} />
        ),
      )}
    </div>
  );
}
