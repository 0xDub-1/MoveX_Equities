"use client";

// =============================================================================
// How it works
// =============================================================================
//
// Four steps for a first visit. Collapsed once there is something to trade,
// open when the board is empty and the reader has nothing else to look at.
// The steps are the same on both venues; only the nouns and the clock differ.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { VENUES, type Venue } from "@/lib/venue";

import { Eyebrow } from "@/components/ui/primitives";

function stepsOf(venue: Venue) {
  const { noun, nounPlural, dayNoun } = VENUES[venue];
  const window =
    venue === "crypto"
      ? "A daily market runs midnight to midnight UTC; an hourly one, top of the hour to top of the hour."
      : "A daily market runs close to close; an hourly one, within the session.";
  return [
    {
      n: "01",
      title: "One question per market",
      body: `Will the ${noun} move more than the threshold? Up or down does not matter. A 2% drop and a 2% rise are the same answer. ${window}`,
    },
    {
      n: "02",
      title: `Three thresholds per ${noun}`,
      body: `TIGHT, FAIR and WIDE are the 25th, 50th and 75th percentiles of the last 20 ${dayNoun}s. Nobody picks them, and the 20 numbers live on chain next to each market.`,
    },
    {
      n: "03",
      title: "Answer YES or NO",
      body: `Deposits on each answer form a pool. The other pool is your counterparty, so the less popular answer pays more. Late deposits after lock are capped, so they never dilute the ${nounPlural === "stocks" ? "money" : "money"} that was there first.`,
    },
    {
      n: "04",
      title: "Settle and claim",
      body: "At lock the reference price is recorded. At settle the move is measured and the winning answer splits the pot, less a 1% fee, pro rata.",
    },
  ];
}

export default function HowItWorks({
  defaultOpen = false,
  venue,
}: {
  defaultOpen?: boolean;
  venue: Venue;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = stepsOf(venue);

  return (
    <div className="rounded-md border border-line-2 bg-surface-1/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-between gap-3 px-4 text-left sm:px-5"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <Eyebrow>How it works</Eyebrow>
          <span className="hidden text-[13px] text-text-2 sm:inline">
            Will it move more than the threshold? YES or NO.
          </span>
        </span>
        <ChevronDown size={15} className={cn("text-text-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-px border-t border-line-1 bg-line-1 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="bg-surface-1 p-4 sm:p-5">
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
      )}
    </div>
  );
}
