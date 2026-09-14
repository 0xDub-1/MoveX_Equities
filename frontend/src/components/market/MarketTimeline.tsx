"use client";

// =============================================================================
// 04 Timeline
// =============================================================================
//
// The four moments of a market as a stepper, horizontal on wide screens and
// vertical on narrow ones. Where the market stands comes from its phase.

import { Check, X } from "lucide-react";

import { fmtEtDateTime } from "@/lib/calendar";
import { VOID_GRACE_SECS } from "@/lib/config";
import type { MarketPhase, MarketView } from "@/lib/market";
import { cn } from "@/lib/utils";
import { SectionHeader, Surface } from "@/components/ui/primitives";

type Status = "done" | "active" | "future" | "skipped";

interface Step {
  label: string;
  time: string;
  detail: string;
  status: Status;
}

const CURRENT: Record<MarketPhase, number> = {
  deposits: 0,
  "awaiting-lock": 1,
  live: 2,
  "awaiting-settle": 2,
  // The step it could not complete is behind it; the refund is what is left.
  expired: 3,
  settled: 3,
  voided: 3,
};

function stepsOf(market: MarketView, phase: MarketPhase): Step[] {
  const current = CURRENT[phase];
  // An expired market is on the same path as a voided one: it cannot
  // resolve, and a refund is the only step left.
  const voided = phase === "voided" || phase === "expired";
  const locked = market.referencePrice > 0n;

  const status = (i: number): Status => {
    if (voided) {
      if (i === 3) return "active";
      if (i === 2) return "skipped";
      if (i === 1) return locked ? "done" : "skipped";
      return "done";
    }
    if (i < current) return "done";
    return i === current ? "active" : "future";
  };

  return [
    {
      label: "Deposits open",
      time: phase === "deposits" ? "Open now" : "Closed at lock",
      detail: "deposits and withdrawals until lock",
      status: status(0),
    },
    {
      label: "Lock",
      time: fmtEtDateTime(market.lockTs),
      detail:
        phase === "awaiting-lock"
          ? "waiting for the crank"
          : voided && !locked
            ? "never locked"
            : "reference price recorded",
      status: status(1),
    },
    {
      label: "Settle",
      time: fmtEtDateTime(market.settleTs),
      detail: voided
        ? "did not settle in time"
        : phase === "awaiting-settle"
          ? "waiting for the crank"
          : "settlement price recorded, winner decided",
      status: status(2),
    },
    voided
      ? {
          label: "Refund",
          time: phase === "voided" ? "Open now" : fmtEtDateTime(market.settleTs + VOID_GRACE_SECS),
          detail: "every deposit refunded in full",
          status: status(3),
        }
      : {
          label: "Claim",
          time: phase === "settled" ? "Open now" : "After settlement",
          detail: "winners collect, pro rata",
          status: status(3),
        },
  ];
}

function Marker({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
        status === "done" && "border-brand/40 bg-brand/15 text-brand",
        status === "active" && "border-brand bg-brand text-[#06070A]",
        (status === "future" || status === "skipped") && "border-line-2 text-text-4",
      )}
    >
      {status === "done" && <Check size={11} strokeWidth={2.5} />}
      {status === "active" && <span className="h-1.5 w-1.5 rounded-full bg-[#06070A]" />}
      {status === "future" && <span className="h-1 w-1 rounded-full bg-line-3" />}
      {status === "skipped" && <X size={10} />}
    </span>
  );
}

export default function MarketTimeline({
  market,
  phase,
}: {
  market: MarketView;
  phase: MarketPhase;
}) {
  const steps = stepsOf(market, phase);

  return (
    <Surface as="section">
      <SectionHeader number="04" label="Timeline" />

      <ol className="flex flex-col px-4 sm:px-5 pt-5 pb-4 sm:flex-row">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          const dim = step.status === "future" || step.status === "skipped";
          return (
            <li key={step.label} className="relative flex min-w-0 gap-3 sm:flex-1 sm:flex-col sm:gap-2.5">
              <div className="flex flex-col items-center sm:w-full sm:flex-row">
                <Marker status={step.status} />
                {!last && (
                  <span
                    className={cn(
                      "my-1 w-px flex-1 sm:mx-2 sm:my-0 sm:h-px sm:w-auto",
                      step.status === "done" ? "bg-brand/40" : "bg-line-2",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 sm:pr-3", last ? "pb-0" : "pb-5 sm:pb-0")}>
                <p
                  className={cn(
                    "text-[13px] font-medium leading-tight",
                    step.status === "active" && "text-text-1",
                    step.status === "done" && "text-text-2",
                    dim && "text-text-4",
                  )}
                >
                  {step.label}
                </p>
                <p className={cn("mt-1 font-mono text-[11.5px] tabular", dim ? "text-text-4" : "text-text-3")}>
                  {step.time}
                </p>
                <p className={cn("mt-0.5 text-[11px] leading-snug", dim ? "text-text-4" : "text-text-3")}>
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-line-1 px-4 sm:px-5 py-3 text-[12px] text-text-3">
        If the market cannot settle within six hours of its settle time, anyone can void it and every
        deposit is refunded in full.
      </p>
    </Surface>
  );
}
