"use client";

// =============================================================================
// USDX faucet
// =============================================================================
//
// The program's own faucet: one allowance per wallet per cooldown, minted by
// the faucet PDA. The first draw also creates the wallet's USDX account.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SystemProgram, type PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import { POLL_MS, QUOTE_MINT, explorerTx } from "@/lib/config";
import { describeError } from "@/lib/errors";
import { faucetClaimPda, faucetPda, quoteAta } from "@/lib/pda";
import { toast } from "@/store/toast";

import { balancesKey } from "./useBalances";
import { useProgram } from "./useProgram";

export interface FaucetState {
  /** USDX base units per draw. */
  amountPerClaim: bigint;
  cooldownSecs: number;
  /** Unix seconds of the wallet's last draw, zero if never. */
  lastClaimTs: number;
  totalClaimed: bigint;
  exists: boolean;
}

function faucetKey(owner: PublicKey | null) {
  return ["faucet", owner?.toBase58() ?? null] as const;
}

export function useFaucet(owner: PublicKey | null) {
  const { reader, writer } = useProgram();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: faucetKey(owner),
    queryFn: async (): Promise<FaucetState> => {
      const [faucet, claim] = await Promise.all([
        reader.account.faucet.fetchNullable(faucetPda()),
        owner ? reader.account.faucetClaim.fetchNullable(faucetClaimPda(owner)) : null,
      ]);
      return {
        amountPerClaim: BigInt(faucet?.amountPerClaim.toString() ?? "0"),
        cooldownSecs: Number(faucet?.cooldownSecs.toString() ?? "0"),
        lastClaimTs: claim ? Number(claim.lastClaimTs.toString()) : 0,
        totalClaimed: BigInt(claim?.totalClaimed.toString() ?? "0"),
        exists: !!faucet,
      };
    },
    refetchInterval: POLL_MS.faucet,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!writer || !owner) throw new Error("Wallet not connected");
      const ata = quoteAta(owner);
      return writer.methods
        .faucetMint()
        .accountsPartial({
          user: owner,
          faucet: faucetPda(),
          claim: faucetClaimPda(owner),
          mint: QUOTE_MINT,
          userTokenAccount: ata,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, QUOTE_MINT),
        ])
        .rpc();
    },
    onSuccess: (signature) => {
      toast.success("USDX minted to your wallet.", "Faucet", {
        href: explorerTx(signature),
        label: "View transaction",
      });
      void queryClient.invalidateQueries({ queryKey: faucetKey(owner) });
      void queryClient.invalidateQueries({ queryKey: balancesKey(owner) });
    },
    onError: (err) => {
      const d = describeError(err);
      if (d.cancelled) toast.warning(d.message, d.title);
      else toast.error(d.message, d.title);
    },
  });

  const readyAt = query.data ? query.data.lastClaimTs + query.data.cooldownSecs : 0;

  return {
    ...query,
    readyAt,
    claim: mutation.mutateAsync,
    claiming: mutation.isPending,
  };
}
