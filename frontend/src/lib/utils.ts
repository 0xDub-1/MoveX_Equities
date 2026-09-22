import type { CSSProperties } from "react";

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, resolving conflicting utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Places a label centred on `pct` of a track, except at either end, where a
 * centred label would hang half of itself outside the track and be clipped.
 */
export function pinned(pct: number): CSSProperties {
  if (pct <= 6) return { left: 0 };
  if (pct >= 94) return { right: 0 };
  return { left: `${pct}%`, transform: "translateX(-50%)" };
}
