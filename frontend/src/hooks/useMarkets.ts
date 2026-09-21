"use client";

// =============================================================================
// Markets
// =============================================================================
//
// Every market the program has ever created, read straight from chain with
// one getProgramAccounts call and decoded once. There is no backend: the
// list a visitor sees is the list the program holds, filtered to the assets
// this interface lists. Anyone can create a market on the program, so a
// board that showed whatever it found would be a board anyone could write on.

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";

import { isListed, symbolsOf } from "@/lib/assets";
import { POLL_MS } from "@/lib/config";
import { byLockThenTier, decodeMarket, type MarketView } from "@/lib/market";
import type { Venue } from "@/lib/venue";

import { useProgram } from "./useProgram";

export const MARKETS_KEY = ["markets"] as const;

export function useMarkets() {
  const { reader } = useProgram();

  return useQuery({
    queryKey: MARKETS_KEY,
    queryFn: async (): Promise<MarketView[]> => {
      const all = await reader.account.market.all();
      return all
        .map((a) => decodeMarket(a.publicKey, a.account))
        .filter((m) => isListed(m.symbol))
        .sort(byLockThenTier);
    },
    refetchInterval: POLL_MS.markets,
  });
}

/** The markets of one venue, from the same query. */
export function useVenueMarkets(venue: Venue) {
  const query = useMarkets();
  const symbols = useMemo(() => new Set(symbolsOf(venue)), [venue]);
  const data = useMemo(
    () => query.data?.filter((m) => symbols.has(m.symbol)),
    [query.data, symbols],
  );
  return { ...query, data };
}

/**
 * One market by address. Seeded from the list when it is already there, and
 * refreshed on its own cadence so the detail page tracks the pools closely.
 */
export function useMarket(key: string | undefined) {
  const { reader } = useProgram();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["market", key],
    enabled: !!key,
    queryFn: async (): Promise<MarketView | null> => {
      const address = new PublicKey(key!);
      const raw = await reader.account.market.fetchNullable(address);
      if (!raw) return null;
      const market = decodeMarket(address, raw);
      // A market on an unlisted symbol is not shown, whatever its address.
      return isListed(market.symbol) ? market : null;
    },
    initialData: () => {
      const listed = queryClient.getQueryData<MarketView[]>(MARKETS_KEY);
      return listed?.find((m) => m.key === key);
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(MARKETS_KEY)?.dataUpdatedAt,
    refetchInterval: 10_000,
  });
}
