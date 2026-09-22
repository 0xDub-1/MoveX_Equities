"use client";

// =============================================================================
// Board toolbar
// =============================================================================
//
// The two narrowing choices under the instrument tabs: where in its life a
// market is, and which asset. Counts are scoped to the current instrument
// and asset so every number is what the board will show.

import { RefreshCw } from "lucide-react";

import { STAGES, STAGE_META, type Stage } from "@/lib/board";
import { cn } from "@/lib/utils";

import { SegmentedControl } from "@/components/ui/primitives";

export default function BoardToolbar({
  stage,
  onStage,
  stageCounts,
  asset,
  onAsset,
  assets,
  refreshing,
  onRefresh,
}: {
  stage: Stage;
  onStage: (stage: Stage) => void;
  stageCounts: Record<Stage, number>;
  asset: string;
  onAsset: (asset: string) => void;
  /** Symbols that have markets in the current instrument. */
  assets: string[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line-1 py-3">
      <SegmentedControl
        value={stage}
        onChange={onStage}
        options={STAGES.map((s) => ({
          value: s,
          label: STAGE_META[s].label,
          count: stageCounts[s],
          title: STAGE_META[s].hint,
          disabled: stageCounts[s] === 0 && s !== stage,
        }))}
      />
      {/* On a phone the refresh button shares the first row with the stages
          and the asset control takes a row of its own; from sm up all three
          sit on one line. */}
      <button
        type="button"
        onClick={onRefresh}
        className={cn(
          "order-2 ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line-1 text-text-3 transition-colors hover:bg-white/[0.04] hover:text-text-1 sm:order-3",
          assets.length > 1 && "sm:ml-0",
          refreshing && "text-brand",
        )}
        title="Refresh from chain"
        aria-label="Refresh from chain"
      >
        <RefreshCw size={12} className={cn(refreshing && "animate-spin")} />
      </button>
      {assets.length > 1 && (
        <div className="order-3 min-w-0 basis-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-2 sm:ml-auto sm:basis-auto">
          <SegmentedControl
            size="sm"
            value={asset}
            onChange={onAsset}
            options={[{ value: "all", label: "All" }, ...assets.map((a) => ({ value: a, label: a }))]}
          />
        </div>
      )}
    </div>
  );
}
