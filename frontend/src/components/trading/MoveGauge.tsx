"use client";

// =============================================================================
// Move gauge
// =============================================================================
//
// The instrument at the centre of every market page. A price axis centred on
// the reference price, the threshold marked symmetrically on both sides, and
// the live oracle print as a marker that slides along it. The band between
// the thresholds is BELOW territory, everything outside it is ABOVE, so a
// glance says which side is winning and by how much.
//
// Laid out in HTML rather than SVG so the type stays legible at every width:
// positions are percentages of the track, labels are real text.

import { useMemo } from "react";
import { motion } from "framer-motion";

import { fmtPct, fmtPrice } from "@/lib/format";
import {
  TIER_META,
  priceToNumber,
  signedMovePct,
  type MarketState,
  type Side,
  type Tier,
} from "@/lib/market";
import { cn } from "@/lib/utils";

export interface GaugeSibling {
  tier: Tier;
  strikeBps: number;
}

export interface MoveGaugeProps {
  /** Scaled 1e8. Zero means the market has not locked. */
  reference: bigint;
  /** Scaled 1e8. The live print, or the settlement print once settled. */
  current: bigint | undefined;
  strikeBps: number;
  tier: Tier;
  state: MarketState;
  winningSide?: Side | null;
  /** Other rungs of the same ladder, drawn as faint ticks. */
  siblings?: GaugeSibling[];
  /** Whether the reference shown is the live price standing in for one. */
  provisional?: boolean;
  className?: string;
}

/** Track padding on each side, as a percentage, so labels never clip. */
const PAD = 7;

function xOf(pct: number, half: number): number {
  const clamped = Math.max(-half, Math.min(half, pct));
  return 50 + (clamped / half) * (50 - PAD);
}

export default function MoveGauge({
  reference,
  current,
  strikeBps,
  tier,
  state,
  winningSide,
  siblings = [],
  provisional = false,
  className,
}: MoveGaugeProps) {
  const strikePct = strikeBps / 100;

  const model = useMemo(() => {
    const ref = reference > 0n ? reference : (current ?? 0n);
    const refNumber = priceToNumber(ref);
    const move = ref > 0n && current !== undefined ? signedMovePct(ref, current) : null;

    const siblingMax = siblings.reduce((m, s) => Math.max(m, s.strikeBps / 100), 0);
    const half = Math.max(
      strikePct * 1.7,
      siblingMax * 1.2,
      move !== null ? Math.abs(move) * 1.3 : 0,
      0.05,
    );

    const lower = refNumber * (1 - strikePct / 100);
    const upper = refNumber * (1 + strikePct / 100);

    const leading: Side | null =
      state === "settled"
        ? (winningSide ?? null)
        : move !== null && ref > 0n
          ? Math.abs(move) > strikePct
            ? "above"
            : "below"
          : null;

    return {
      ref,
      refNumber,
      move,
      half,
      lower,
      upper,
      leading,
      xL: xOf(-strikePct, half),
      xR: xOf(strikePct, half),
      xC: move !== null ? xOf(move, half) : 50,
      currentNumber: current !== undefined ? priceToNumber(current) : null,
    };
  }, [reference, current, strikePct, siblings, state, winningSide]);

  const hasReference = model.ref > 0n;
  const resolved = state === "settled" || state === "voided";
  const leadingIsAbove = model.leading === "above";
  const leadingIsBelow = model.leading === "below";
  const markerTone = leadingIsAbove ? "above" : leadingIsBelow ? "below" : "neutral";

  return (
    <div className={cn("relative select-none", className)}>
      {/* Zone captions */}
      <div className="relative h-5 font-mono text-[9.5px] tracking-[0.18em] uppercase">
        <span
          className={cn(
            "absolute -translate-x-1/2 transition-colors",
            leadingIsAbove ? "text-above" : "text-text-4",
          )}
          style={{ left: `${(PAD + model.xL) / 2}%` }}
        >
          Above
        </span>
        <span
          className={cn(
            "absolute -translate-x-1/2 transition-colors",
            leadingIsBelow ? "text-below" : "text-text-4",
          )}
          style={{ left: "50%" }}
        >
          Below
        </span>
        <span
          className={cn(
            "absolute -translate-x-1/2 transition-colors",
            leadingIsAbove ? "text-above" : "text-text-4",
          )}
          style={{ left: `${(model.xR + 100 - PAD) / 2}%` }}
        >
          Above
        </span>
      </div>

      {/* Marker label row */}
      <div className="relative h-12">
        {hasReference && model.currentNumber !== null && (
          <motion.div
            className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
            initial={false}
            animate={{ left: `${model.xC}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 22 }}
          >
            <div
              className={cn(
                "flex items-baseline gap-1.5 rounded-sm border px-2 py-1 whitespace-nowrap backdrop-blur-sm",
                markerTone === "above" && "border-above/40 bg-above/10 text-above",
                markerTone === "below" && "border-below/40 bg-below/10 text-below",
                markerTone === "neutral" && "border-line-2 bg-surface-2 text-text-1",
              )}
            >
              <span className="font-mono text-[12px] font-semibold tabular">
                {fmtPrice(model.currentNumber)}
              </span>
              {model.move !== null && (
                <span className="font-mono text-[10.5px] tabular opacity-80">
                  {fmtPct(model.move, { signed: true })}
                </span>
              )}
            </div>
            <div
              className={cn(
                "w-px h-2",
                markerTone === "above" && "bg-above/70",
                markerTone === "below" && "bg-below/70",
                markerTone === "neutral" && "bg-line-3",
              )}
            />
          </motion.div>
        )}
      </div>

      {/* Track */}
      <div className="relative h-11">
        <div className="absolute inset-y-0 left-0 right-0 overflow-hidden rounded-sm">
          {/* ABOVE left */}
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              leadingIsAbove ? "bg-above/[0.16]" : "bg-above/[0.06]",
              resolved && !leadingIsAbove && "bg-white/[0.02]",
            )}
            style={{ left: 0, width: `${model.xL}%` }}
          />
          {/* BELOW */}
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              leadingIsBelow ? "bg-below/[0.18]" : "bg-below/[0.07]",
              resolved && !leadingIsBelow && "bg-white/[0.02]",
            )}
            style={{ left: `${model.xL}%`, width: `${model.xR - model.xL}%` }}
          />
          {/* ABOVE right */}
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              leadingIsAbove ? "bg-above/[0.16]" : "bg-above/[0.06]",
              resolved && !leadingIsAbove && "bg-white/[0.02]",
            )}
            style={{ left: `${model.xR}%`, right: 0 }}
          />

          {/* Fine scale ticks */}
          {Array.from({ length: 21 }, (_, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-px h-1.5 bg-white/[0.07]"
              style={{ left: `${PAD + ((100 - PAD * 2) * i) / 20}%` }}
            />
          ))}
        </div>

        {/* Sibling rungs */}
        {siblings
          .filter((s) => s.tier !== tier)
          .flatMap((s) => {
            const pct = s.strikeBps / 100;
            return [-pct, pct].map((p, i) => (
              <div
                key={`${s.tier}-${i}`}
                className="absolute top-1 bottom-1 w-px bg-white/[0.14]"
                style={{ left: `${xOf(p, model.half)}%` }}
                title={`${TIER_META[s.tier].label} ${fmtPct(pct)}`}
              >
                <span className="absolute top-full mt-0.5 -translate-x-1/2 font-mono text-[8px] text-text-4 uppercase">
                  {TIER_META[s.tier].label[0]}
                </span>
              </div>
            ));
          })}

        {/* Threshold lines */}
        {[model.xL, model.xR].map((x, i) => (
          <div
            key={i}
            className={cn(
              "absolute -top-1 -bottom-1 w-[1.5px] transition-colors",
              leadingIsAbove ? "bg-above/80" : leadingIsBelow ? "bg-below/80" : "bg-white/45",
            )}
            style={{ left: `${x}%` }}
          />
        ))}

        {/* Reference line */}
        <div
          className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-white/40"
          style={{ left: "50%" }}
        />

        {/* Needle */}
        {hasReference && model.currentNumber !== null && (
          <motion.div
            className="absolute -top-2 -bottom-2 -translate-x-1/2 flex flex-col items-center justify-center"
            initial={false}
            animate={{ left: `${model.xC}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 22 }}
          >
            <div
              className={cn(
                "absolute inset-y-0 w-[2px] rounded-full",
                markerTone === "above" && "bg-above",
                markerTone === "below" && "bg-below",
                markerTone === "neutral" && "bg-text-1",
              )}
            />
            <div
              className={cn(
                "relative h-3.5 w-3.5 rounded-full border-2 border-[#06070A]",
                markerTone === "above" && "bg-above shadow-[0_0_0_4px_rgba(174,203,49,0.25)]",
                markerTone === "below" && "bg-below shadow-[0_0_0_4px_rgba(78,161,255,0.25)]",
                markerTone === "neutral" && "bg-text-1 shadow-[0_0_0_4px_rgba(255,255,255,0.15)]",
              )}
            />
          </motion.div>
        )}
      </div>

      {/* Threshold and reference labels */}
      <div className="relative h-11 mt-2">
        <div
          className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5"
          style={{ left: `${model.xL}%` }}
        >
          <span className="font-mono text-[11px] font-semibold tabular text-text-1">
            {fmtPct(-strikePct, { signed: true })}
          </span>
          <span className="font-mono text-[10px] tabular text-text-3">
            {hasReference ? fmtPrice(model.lower) : "--"}
          </span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-text-3">
            {provisional ? "Live" : "Reference"}
          </span>
          <span className="font-mono text-[11px] font-semibold tabular text-text-1">
            {hasReference ? fmtPrice(model.refNumber) : "Set at lock"}
          </span>
        </div>
        <div
          className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5"
          style={{ left: `${model.xR}%` }}
        >
          <span className="font-mono text-[11px] font-semibold tabular text-text-1">
            {fmtPct(strikePct, { signed: true })}
          </span>
          <span className="font-mono text-[10px] tabular text-text-3">
            {hasReference ? fmtPrice(model.upper) : "--"}
          </span>
        </div>
      </div>
    </div>
  );
}
