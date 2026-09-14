// =============================================================================
// Session price history
// =============================================================================
//
// The chain holds only the latest print per feed, so the sparkline on the
// ticker strip is built from what this tab has seen since it opened. It is
// honest about that: a few minutes in, it is a few points long.

import { create } from "zustand";

export interface PricePoint {
  /** Unix seconds, the feed's publish time. */
  t: number;
  /** Price as a float, for drawing only. */
  p: number;
}

interface PriceHistoryStore {
  series: Record<string, PricePoint[]>;
  push: (symbol: string, point: PricePoint) => void;
}

const MAX_POINTS = 360;

export const usePriceHistory = create<PriceHistoryStore>((set) => ({
  series: {},
  push: (symbol, point) =>
    set((state) => {
      const current = state.series[symbol] ?? [];
      const last = current[current.length - 1];
      if (last && last.t >= point.t) return state;
      return {
        series: { ...state.series, [symbol]: [...current, point].slice(-MAX_POINTS) },
      };
    }),
}));
