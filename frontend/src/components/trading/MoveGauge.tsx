"use client";

// =============================================================================
// Move gauge
// =============================================================================
//
// The instrument at the centre of every market page. A price axis centred on
// the reference price with the threshold marked on both sides of it, and the
// live print as a marker that slides along. The band between the marks is
// where NO wins; leave it on either side and YES wins. Every zone says so in
// words, because the symmetry is the one thing people do not expect.
//
// Laid out in HTML rather than SVG so the type stays legible at every width:
// positions are percentages of the track, labels are real text.

import { useMemo } from "react";
import { motion } from "framer-motion";

import { fmtPct, fmtPrice } from "@/lib/format";
import {
  SIDE_META,
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
const PAD = 8;

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
      lower: refNumber * (1 - strikePct / 100),
      upper: refNumber * (1 + strikePct / 100),
      leading,
      xL: xOf(-strikePct, half),
      xR: xOf(strikePct, half),
      xC: move !== null ? xOf(move, half) : 50,
      currentNumber: current !== undefined ? priceToNumber(current) : null,
    };
  }, [reference, current, strikePct, siblings, state, winningSide]);

  const hasReference = model.ref > 0n;
  const resolved = state === "settled" || state === "voided";
  const yesLeads = model.leading === "above";
  const noLeads = model.leading === "below";
  const tone = yesLeads ? "above" : noLeads ? "below" : "neutral";
  const strikeLabel = fmtPct(strikePct);

  const zone = (title: string, side: Side, x: number, active: boolean) => (
    <div
      className="absolute -translate-x-1/2 text-center whitespace-nowrap"
      style={{ left: `${x}%` }}
    >
      <p className={cn("text-[12px] font-medium", active ? "text-text-1" : "text-text-3")}>{title}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[11px] font-semibold tracking-[0.08em]",
          active ? (side === "above" ? "text-above" : "text-below") : "text-text-4",
        )}
      >
        {SIDE_META[side].label} wins
      </p>
    </div>
  );

  return (
    <div className={cn("relative select-none", className)}>
      {/* Zones, in words */}
      <div className="relative h-10">
        {zone(`Falls more than ${strikeLabel}`, "above", (PAD + model.xL) / 2, yesLeads)}
        {zone(`Stays within ${strikeLabel}`, "below", 50, noLeads)}
        {zone(`Rises more than ${strikeLabel}`, "above", (model.xR + 100 - PAD) / 2, yesLeads)}
      </div>

      {/* Marker label */}
      <div className="relative mt-3 h-12">
        {hasReference && model.currentNumber !== null && (
          <motion.div
            className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
            initial={false}
            animate={{ left: `${model.xC}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 22 }}
          >
            <div
              className={cn(
                "flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 whitespace-nowrap backdrop-blur-sm",
                tone === "above" && "border-above/50 bg-above/10",
                tone === "below" && "border-below/50 bg-below/10",
                tone === "neutral" && "border-line-3 bg-surface-2",
              )}
            >
              <span className="font-mono text-[14px] font-semibold tabular text-text-1">
                {fmtPrice(model.currentNumber)}
              </span>
              {model.move !== null && (
                <span
                  className={cn(
                    "font-mono text-[12px] tabular",
                    tone === "above" && "text-above",
                    tone === "below" && "text-below",
                    tone === "neutral" && "text-text-2",
                  )}
                >
                  {fmtPct(model.move, { signed: true })}
                </span>
              )}
            </div>
            <div
              className={cn(
                "w-px h-2",
                tone === "above" && "bg-above/70",
                tone === "below" && "bg-below/70",
                tone === "neutral" && "bg-line-3",
              )}
            />
          </motion.div>
        )}
      </div>

      {/* Track */}
      <div className="relative h-12">
        <div className="absolute inset-y-0 left-0 right-0 overflow-hidden rounded-md">
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              yesLeads ? "bg-above/[0.2]" : "bg-above/[0.07]",
              resolved && !yesLeads && "bg-white/[0.03]",
            )}
            style={{ left: 0, width: `${model.xL}%` }}
          />
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              noLeads ? "bg-below/[0.22]" : "bg-below/[0.09]",
              resolved && !noLeads && "bg-white/[0.03]",
            )}
            style={{ left: `${model.xL}%`, width: `${model.xR - model.xL}%` }}
          />
          <div
            className={cn(
              "absolute inset-y-0 transition-colors duration-500",
              yesLeads ? "bg-above/[0.2]" : "bg-above/[0.07]",
              resolved && !yesLeads && "bg-white/[0.03]",
            )}
            style={{ left: `${model.xR}%`, right: 0 }}
          />
          {Array.from({ length: 21 }, (_, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-px h-1.5 bg-white/[0.08]"
              style={{ left: `${PAD + ((100 - PAD * 2) * i) / 20}%` }}
            />
          ))}
        </div>

        {/* Other rungs of the ladder */}
        {siblings
          .filter((s) => s.tier !== tier)
          .flatMap((s) => {
            const pct = s.strikeBps / 100;
            return [-pct, pct].map((p, i) => (
              <div
                key={`${s.tier}-${i}`}
                className="absolute top-1.5 bottom-1.5 w-px bg-white/[0.18]"
                style={{ left: `${xOf(p, model.half)}%` }}
                title={`${TIER_META[s.tier].label} threshold, ${fmtPct(pct)}`}
              >
                <span className="absolute top-full mt-1 -translate-x-1/2 font-mono text-[10.5px] uppercase text-text-4">
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
              "absolute -top-1 -bottom-1 w-[2px] rounded-full transition-colors",
              yesLeads ? "bg-above" : noLeads ? "bg-below" : "bg-white/60",
            )}
            style={{ left: `${x}%`, transform: "translateX(-1px)" }}
          />
        ))}

        {/* Reference line */}
        <div
          className="absolute -top-1 -bottom-1 border-l border-dashed border-white/50"
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
                tone === "above" && "bg-above",
                tone === "below" && "bg-below",
                tone === "neutral" && "bg-text-1",
              )}
            />
            <div
              className={cn(
                "relative h-4 w-4 rounded-full border-2 border-[#06070A]",
                tone === "above" && "bg-above shadow-[0_0_0_4px_rgba(174,203,49,0.28)]",
                tone === "below" && "bg-below shadow-[0_0_0_4px_rgba(78,161,255,0.28)]",
                tone === "neutral" && "bg-text-1 shadow-[0_0_0_4px_rgba(255,255,255,0.16)]",
              )}
            />
          </motion.div>
        )}
      </div>

      {/* Prices under the lines */}
      <div className="relative mt-3 h-12">
        <div className="absolute -translate-x-1/2 text-center" style={{ left: `${model.xL}%` }}>
          <p className="font-mono text-[12.5px] font-semibold tabular text-text-1">
            {fmtPct(-strikePct, { signed: true })}
          </p>
          <p className="font-mono text-[11.5px] tabular text-text-3">
            {hasReference ? fmtPrice(model.lower) : "--"}
          </p>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-3">
            {provisional ? "Live price" : "Reference"}
          </p>
          <p className="font-mono text-[12.5px] font-semibold tabular text-text-1">
            {hasReference ? fmtPrice(model.refNumber) : "Set at lock"}
          </p>
        </div>
        <div className="absolute -translate-x-1/2 text-center" style={{ left: `${model.xR}%` }}>
          <p className="font-mono text-[12.5px] font-semibold tabular text-text-1">
            {fmtPct(strikePct, { signed: true })}
          </p>
          <p className="font-mono text-[11.5px] tabular text-text-3">
            {hasReference ? fmtPrice(model.upper) : "--"}
          </p>
        </div>
      </div>
    </div>
  );
}
