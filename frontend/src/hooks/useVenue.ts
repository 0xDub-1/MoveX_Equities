"use client";

// =============================================================================
// Which venue the visitor is looking at
// =============================================================================
//
// From the route where the route says so, and from the market where it does
// not: a market page carries no venue in its address, but its symbol is in
// the registry. Null on the pages both venues share.

import { usePathname } from "next/navigation";

import { venueOfSymbol } from "@/lib/assets";
import { venueOfPath, type Venue } from "@/lib/venue";

import { useMarkets } from "./useMarkets";

export function useVenue(): Venue | null {
  const pathname = usePathname();
  const fromPath = venueOfPath(pathname);
  const { data: markets } = useMarkets();

  if (fromPath) return fromPath;
  if (pathname.startsWith("/market/")) {
    const key = pathname.split("/")[2];
    const market = markets?.find((m) => m.key === key);
    return market ? venueOfSymbol(market.symbol) : null;
  }
  return null;
}
