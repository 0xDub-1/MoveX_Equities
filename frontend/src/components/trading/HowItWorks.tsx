"use client";

// =============================================================================
// How it works
// =============================================================================
//
// Four steps for a first visit. Collapsed once there is something to trade,
// open when the board is empty and the reader has nothing else to look at.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { Eyebrow } from "@/components/ui/primitives";

const STEPS = [
  {
    n: "01",
    title: "Three thresholds per stock",
    body: "TIGHT, FAIR and WIDE are the 25th, 50th and 75th percentiles of the last 20 moves. Nobody picks them, and the 20 numbers live on chain.",
  },
  {
    n: "02",
    title: "Pick a side",
    body: "ABOVE if you think the stock moves more than the threshold, BELOW if it stays within. Up or down is never measured. A 2% drop and a 2% rise are the same outcome.",
  },
  {
    n: "03",
    title: "Two pools, one pot",
    body: "Deposits on each side form a pool. The opposing pool is your counterparty. Backing the less popular side pays more.",
  },
  {
    n: "04",
    title: "Settle and claim",
    body: "At lock the reference price is recorded. At settle the move is measured and the winning side splits the pot, less a 1% fee, pro rata. Voided markets refund in full.",
  },
];

export default function HowItWorks({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-md border border-line-1 bg-surface-1/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 h-11 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <Eyebrow>How it works</Eyebrow>
          <span className="hidden sm:inline text-[12px] text-text-3">
            One question per market: will it move more than this?
          </span>
        </span>
        <ChevronDown size={14} className={cn("text-text-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-line-1 border-t border-line-1">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-surface-1 p-4 sm:p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="font-mono text-[10px] text-brand border border-line-2 rounded-sm px-1.5 py-0.5">
                  {s.n}
                </span>
                <span className="text-[13px] font-semibold text-text-1">{s.title}</span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-text-3">{s.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
