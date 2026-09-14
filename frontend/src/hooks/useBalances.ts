"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";

import { POLL_MS } from "@/lib/config";
import { quoteAta } from "@/lib/pda";

export interface Balances {
  lamports: number;
  sol: number;
  /** USDX base units. Zero when the token account does not exist yet. */
  usdx: bigint;
  hasTokenAccount: boolean;
}

export function balancesKey(owner: PublicKey | null) {
  return ["balances", owner?.toBase58() ?? null] as const;
}

export function useBalances(owner: PublicKey | null) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: balancesKey(owner),
    enabled: !!owner,
    queryFn: async (): Promise<Balances> => {
      const [lamports, token] = await Promise.all([
        connection.getBalance(owner!, "confirmed"),
        connection
          .getTokenAccountBalance(quoteAta(owner!), "confirmed")
          .then((r) => ({ amount: BigInt(r.value.amount), exists: true }))
          // The associated account is created on the first faucet draw.
          .catch(() => ({ amount: 0n, exists: false })),
      ]);
      return {
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
        usdx: token.amount,
        hasTokenAccount: token.exists,
      };
    },
    refetchInterval: POLL_MS.balances,
  });
}
