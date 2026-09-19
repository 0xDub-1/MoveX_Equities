"use client";

// =============================================================================
// Positions
// =============================================================================
//
// Every Position account owned by the connected wallet, found by a memcmp on
// the owner field just past the discriminator. A wallet may hold one
// position per side of a market, so a market can come back with two.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";

import { POLL_MS } from "@/lib/config";
import { decodePosition, type PositionView, type Side } from "@/lib/market";

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

/** The connected wallet's positions on one market, by side. */
export type Held = Partial<Record<Side, PositionView>>;

/**
 * The connected wallet's positions on one market. `held` carries only the
 * ones with a stake: a fully withdrawn position stays on chain with a zero
 * balance and is no position for our purposes.
 */
export function usePosition(marketKey: string | undefined, owner: PublicKey | null) {
  const query = usePositions(owner);
  const positions = useMemo(
    () => query.data?.filter((p) => p.marketKey === marketKey) ?? [],
    [query.data, marketKey],
  );
  const held = useMemo<Held>(() => {
    const out: Held = {};
    for (const p of positions) if (p.amount > 0n) out[p.side] = p;
    return out;
  }, [positions]);
  return { ...query, positions, held };
}
