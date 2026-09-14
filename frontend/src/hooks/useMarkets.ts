"use client";

// =============================================================================
// Markets
// =============================================================================
//
// Every market the program has ever created, read straight from chain with
// one getProgramAccounts call and decoded once. There is no backend: the
// list a visitor sees is the list the program holds.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";

import { POLL_MS } from "@/lib/config";
import { byLockThenTier, decodeMarket, type MarketView } from "@/lib/market";

import { useProgram } from "./useProgram";

export const MARKETS_KEY = ["markets"] as const;

export function useMarkets() {
  const { reader } = useProgram();

  return useQuery({
    queryKey: MARKETS_KEY,
    queryFn: async (): Promise<MarketView[]> => {
      const all = await reader.account.market.all();
      return all.map((a) => decodeMarket(a.publicKey, a.account)).sort(byLockThenTier);
    },
    refetchInterval: POLL_MS.markets,
  });
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
      return raw ? decodeMarket(address, raw) : null;
    },
    initialData: () => {
      const listed = queryClient.getQueryData<MarketView[]>(MARKETS_KEY);
      return listed?.find((m) => m.key === key);
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(MARKETS_KEY)?.dataUpdatedAt,
    refetchInterval: 10_000,
  });
}
