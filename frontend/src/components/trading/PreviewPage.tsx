"use client";

// Development-only gallery of the board on fixture data, so every phase of
// both instruments on both venues can be looked at before the keeper has
// posted a market.

import { useMemo } from "react";

import { venueOfSymbol } from "@/lib/assets";
import { stageOf, type Stage } from "@/lib/board";
import { fixtureFeeds, fixtureMarkets } from "@/lib/fixtures";
import type { MarketKind } from "@/lib/market";
import { useNow } from "@/hooks/useNow";

import { Eyebrow, SectionHeader, Surface } from "@/components/ui/primitives";
import AssetGroup from "./AssetGroup";
import MoveGauge from "./MoveGauge";
import SamplesHistogram from "./SamplesHistogram";
import SideSplit from "./SideSplit";

const STAGES: Stage[] = ["open", "live", "resolved"];
const KINDS: MarketKind[] = ["hourly", "daily"];

export default function PreviewPage() {
  const now = useNow();
  // Anchored to a ten minute bucket so the fixtures stay put while the
  // countdowns inside them tick.
  const base = Math.floor(now / 600) * 600;
  const markets = useMemo(() => fixtureMarkets(base), [base]);
  const feeds = useMemo(() => fixtureFeeds(base), [base]);

  if (!now) return null;

  const tslaFair = markets.find((m) => m.symbol === "TSLA" && m.tier === "fair")!;
  const nvdaFair = markets.find((m) => m.symbol === "NVDA" && m.tier === "fair" && m.kind === "daily")!;
  const spyFair = markets.find((m) => m.symbol === "SPY" && m.tier === "fair")!;
  const siblings = (symbol: string) =>
    markets
      .filter((m) => m.symbol === symbol && m.kind === "daily")
      .map((m) => ({ tier: m.tier, strikeBps: m.strikeBps }));

  const symbols = [...new Set(markets.map((m) => m.symbol))];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-4 py-6 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-warning">
        Preview on fixtures. Development only.
      </p>

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
          <div className="flex flex-col gap-6 p-5">
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

      {KINDS.map((kind) =>
        STAGES.map((stage) => {
          const groups = symbols
            .map((symbol) => {
              const all = markets.filter((m) => m.symbol === symbol && m.kind === kind);
              const shown = all.filter((m) => stageOf(m, now) === stage);
              return { symbol, all, shown };
            })
            .filter((g) => g.shown.length > 0);
          if (groups.length === 0) return null;
          return (
            <section key={`${kind}-${stage}`} className="flex flex-col gap-8">
              <Eyebrow>
                {kind} · {stage}
              </Eyebrow>
              {groups.map((g) => (
                <AssetGroup
                  key={`${kind}-${stage}-${g.symbol}`}
                  symbol={g.symbol}
                  kind={kind}
                  all={g.all}
                  shown={g.shown}
                  stage={stage}
                  now={now}
                  feed={feeds[g.symbol]}
                  onStage={() => undefined}
                />
              ))}
              <p className="font-mono text-[10.5px] text-text-4">
                {groups.map((g) => `${g.symbol} ${venueOfSymbol(g.symbol)}`).join(" · ")}
              </p>
            </section>
          );
        }),
      )}
    </div>
  );
}
