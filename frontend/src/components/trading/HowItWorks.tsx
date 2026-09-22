"use client";

// =============================================================================
// How it works
// =============================================================================
//
// Four steps for a first visit, shown under the instrument lede when the
// reader asks for them, or by default when the venue has nothing posted yet.
// No box of its own: hairlines above and below, the same grid as the cards.

import type { Venue } from "@/lib/venue";
import { VENUES } from "@/lib/venue";

function stepsOf(venue: Venue) {
  const { noun, dayNoun } = VENUES[venue];
  const window =
    venue === "crypto"
      ? "A daily market runs midnight to midnight UTC; an hourly one, top of the hour to top of the hour."
      : "A daily market runs close to close; an hourly one, within the session.";
  return [
    {
      n: "01",
      title: "Direction does not count",
      body: `A 2% drop and a 2% rise are the same answer, because the question is only how far the ${noun} moved. ${window}`,
    },
    {
      n: "02",
      title: "Thresholds nobody picks",
      body: `A daily ladder has three: TIGHT, FAIR and WIDE are the 25th, 50th and 75th percentiles of the last 20 ${dayNoun}s. An hourly market has one, read the same way from the last 20 hours. The 20 numbers live on chain next to each market.`,
    },
    {
      n: "03",
      title: "Answer YES or NO",
      body: "Deposits on each answer form a pool. The other pool is your counterparty, so the less popular answer pays more. Deposits after lock are capped, so they never dilute the money that was there first.",
    },
    {
      n: "04",
      title: "Settle and claim",
      body: "At lock the reference price is recorded. At settle the move is measured and the winning answer splits the pot, less a 1% fee, pro rata.",
    },
  ];
}

export default function HowItWorks({ venue }: { venue: Venue }) {
  return (
    <div className="grid grid-cols-1 gap-px border-y border-line-1 bg-line-1 md:grid-cols-2 xl:grid-cols-4">
      {stepsOf(venue).map((s) => (
        <div key={s.n} className="bg-background px-4 py-4 sm:px-5">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="rounded-sm border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-brand">
              {s.n}
            </span>
            <span className="text-[13.5px] font-semibold text-text-1">{s.title}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-text-2">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
