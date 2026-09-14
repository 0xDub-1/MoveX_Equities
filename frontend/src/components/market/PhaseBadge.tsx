"use client";

import { PHASE_META, type MarketPhase } from "@/lib/market";
import { Badge } from "@/components/ui/primitives";

/** The phase as a badge: tone from PHASE_META, a pulsing dot while live. */
export default function PhaseBadge({
  phase,
  size = "md",
}: {
  phase: MarketPhase;
  size?: "sm" | "md";
}) {
  const meta = PHASE_META[phase];
  const live = phase === "live";
  return (
    <Badge tone={meta.tone} dot={live} pulse={live} size={size}>
      {meta.label}
    </Badge>
  );
}
