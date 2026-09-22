"use client";

// =============================================================================
// Instrument tabs
// =============================================================================
//
// The one big choice on the board: hours or days. Each tab carries how many
// of its markets are in play and a pulsing dot while one is being measured,
// so a reader on Daily is still told an hour is live. Sticky under the
// navbar, the only sticky element on the page.

import { INSTRUMENTS, TAB_CAPTION, type Instrument } from "@/lib/board";
import type { Venue } from "@/lib/venue";

import { TabBar } from "@/components/ui/primitives";

export default function InstrumentTabs({
  value,
  onChange,
  venue,
  counts,
}: {
  value: Instrument;
  onChange: (value: Instrument) => void;
  venue: Venue;
  /** Per instrument: markets in play (open plus live) and whether any is live. */
  counts: Record<Instrument, { inPlay: number; live: boolean }>;
}) {
  return (
    <div className="sticky top-14 z-30 -mx-4 bg-[#06070A]/85 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
      <TabBar
        value={value}
        onChange={onChange}
        tabs={INSTRUMENTS.map((i) => ({
          value: i,
          label: i === "hourly" ? "Hourly" : "Daily",
          caption: TAB_CAPTION[venue][i],
          count: counts[i].inPlay,
          live: counts[i].live,
        }))}
      />
    </div>
  );
}
