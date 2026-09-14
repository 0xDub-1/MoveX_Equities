"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { PricePoint } from "@/store/priceHistory";

/**
 * A tiny line of the points this tab has collected. Flat and dashed until
 * there are two points to draw between.
 */
export default function Sparkline({
  points,
  className,
  height = 28,
}: {
  points: PricePoint[];
  className?: string;
  height?: number;
}) {
  const model = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.p);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || max * 0.001 || 1;
    const path = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 100 - ((p.p - min) / span) * 84 - 8;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    const up = values[values.length - 1] >= values[0];
    return { path, up, lastX: 100, lastY: 100 - ((values[values.length - 1] - min) / span) * 84 - 8 };
  }, [points]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("w-full block", className)}
      style={{ height }}
      aria-hidden="true"
    >
      {model ? (
        <>
          <path
            d={model.path}
            fill="none"
            stroke={model.up ? "var(--above)" : "var(--below)"}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={model.lastX}
            cy={model.lastY}
            r="2.2"
            fill={model.up ? "var(--above)" : "var(--below)"}
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
