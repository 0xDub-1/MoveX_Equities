"use client";

// =============================================================================
// Positions
// =============================================================================
//
// Every Position account owned by the connected wallet, found by a memcmp on
// the owner field just past the discriminator.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";

import { POLL_MS } from "@/lib/config";
import { decodePosition, type PositionView } from "@/lib/market";

import { useProgram } from "./useProgram";

export function positionsKey(owner: PublicKey | null) {
  return ["positions", owner?.toBase58() ?? null] as const;
}

export function usePositions(owner: PublicKey | null) {
  const { reader } = useProgram();

  return useQuery({
    queryKey: positionsKey(owner),
    enabled: !!owner,
    queryFn: async (): Promise<PositionView[]> => {
      const all = await reader.account.position.all([
        { memcmp: { offset: 8, bytes: owner!.toBase58() } },
      ]);
      return all.map((a) => decodePosition(a.publicKey, a.account));
    },
    refetchInterval: POLL_MS.positions,
  });
}

/** The connected wallet's position on one market, if any. */
export function usePosition(marketKey: string | undefined, owner: PublicKey | null) {
  const query = usePositions(owner);
  const position = useMemo(
    () => query.data?.find((p) => p.marketKey === marketKey),
    [query.data, marketKey],
  );
  return { ...query, position };
}
