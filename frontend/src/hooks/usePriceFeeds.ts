"use client";

// =============================================================================
// Price feeds
// =============================================================================
//
// The three keeper-published PriceFeed accounts, polled on a short cadence
// and additionally subscribed over the RPC websocket so a fresh print lands
// in the UI the moment it lands on chain.

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";

import { MAX_PRICE_AGE_SECS, POLL_MS, TICKERS } from "@/lib/config";
import { decodePriceFeed, type PriceFeedView } from "@/lib/market";
import { priceFeedPda } from "@/lib/pda";

import { useProgram } from "./useProgram";

export type PriceFeeds = Record<string, PriceFeedView>;

export const FEEDS_KEY = ["priceFeeds"] as const;

const FEED_ADDRESSES = TICKERS.map((symbol) => ({ symbol, address: priceFeedPda(symbol) }));

export function usePriceFeeds() {
  const { reader } = useProgram();
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: FEEDS_KEY,
    queryFn: async (): Promise<PriceFeeds> => {
      const accounts = await reader.account.priceFeed.fetchMultiple(
        FEED_ADDRESSES.map((f) => f.address),
      );
      const out: PriceFeeds = {};
      accounts.forEach((raw, i) => {
        if (!raw) return;
        const view = decodePriceFeed(FEED_ADDRESSES[i].address, raw);
        out[view.symbol] = view;
      });
      return out;
    },
    refetchInterval: POLL_MS.feeds,
  });

  // Live updates. A failed subscription is harmless: polling still runs.
  useEffect(() => {
    const ids = FEED_ADDRESSES.map(({ address }) =>
      connection.onAccountChange(
        address,
        (info) => {
          try {
            const raw = reader.coder.accounts.decode("priceFeed", info.data);
            const view = decodePriceFeed(address, raw);
            queryClient.setQueryData<PriceFeeds>(FEEDS_KEY, (prev) => ({
              ...(prev ?? {}),
              [view.symbol]: view,
            }));
          } catch {
            // A partial write or an unrelated layout: the next poll corrects it.
          }
        },
        "confirmed",
      ),
    );
    return () => {
      for (const id of ids) void connection.removeAccountChangeListener(id);
    };
  }, [connection, reader, queryClient]);

  return query;
}

export function usePriceFeed(symbol: string | undefined): PriceFeedView | undefined {
  const { data } = usePriceFeeds();
  return symbol ? data?.[symbol] : undefined;
}

/** Whether the program would accept this print for a lock or a settlement. */
export function isFeedFresh(feed: PriceFeedView | undefined, nowSec: number): boolean {
  if (!feed || feed.price === 0n || !nowSec) return false;
  return nowSec - feed.publishTime <= MAX_PRICE_AGE_SECS;
}

export function useFeedHealth(nowSec: number) {
  const { data } = usePriceFeeds();
  return useMemo(() => {
    const feeds = Object.values(data ?? {});
    const fresh = feeds.filter((f) => isFeedFresh(f, nowSec)).length;
    return { total: TICKERS.length, fresh, allFresh: fresh === TICKERS.length, anyFresh: fresh > 0 };
  }, [data, nowSec]);
}
