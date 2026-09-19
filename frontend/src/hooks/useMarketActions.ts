"use client";

// =============================================================================
// Deposit, withdraw, claim
// =============================================================================
//
// The three things a user does to a market. Each builds one transaction
// through the wallet-bound program handle, reports through toasts, and
// invalidates every query the outcome touches.
//
// Positions are one per side, so withdraw and claim take the side of the
// position they act on: it is part of the account's address.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import { explorerTx } from "@/lib/config";
import { describeError } from "@/lib/errors";
import { fmtUsdx } from "@/lib/format";
import { SIDE_META, type MarketView, type Side } from "@/lib/market";
import { positionPda, quoteAta } from "@/lib/pda";
import { SIDE_ARG } from "@/lib/program";
import { toast } from "@/store/toast";

import { balancesKey } from "./useBalances";
import { MARKETS_KEY } from "./useMarkets";
import { positionsKey } from "./usePositions";
import { useProgram } from "./useProgram";

export type ActionKind = "deposit" | "withdraw" | "claim";

export function useMarketActions() {
  const { writer, publicKey } = useProgram();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const invalidate = useCallback(
    (market: MarketView) => {
      void queryClient.invalidateQueries({ queryKey: MARKETS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["market", market.key] });
      void queryClient.invalidateQueries({ queryKey: positionsKey(publicKey) });
      void queryClient.invalidateQueries({ queryKey: balancesKey(publicKey) });
    },
    [queryClient, publicKey],
  );

  const run = useCallback(
    async (
      market: MarketView,
      kind: ActionKind,
      title: string,
      success: string,
      send: () => Promise<string>,
    ): Promise<string | null> => {
      if (!writer || !publicKey) {
        toast.warning("Connect a wallet first.", title);
        return null;
      }
      const key = `${market.key}:${kind}`;
      setPending(key);
      const pendingToast = toast.info("Confirm the transaction in your wallet.", title, 60_000);
      try {
        const signature = await send();
        toast.dismiss(pendingToast);
        toast.success(success, title, { href: explorerTx(signature), label: "View transaction" });
        invalidate(market);
        return signature;
      } catch (err) {
        toast.dismiss(pendingToast);
        const d = describeError(err);
        if (d.cancelled) toast.warning(d.message, title);
        else toast.error(d.message, d.title);
        return null;
      } finally {
        setPending((current) => (current === key ? null : current));
      }
    },
    [writer, publicKey, invalidate],
  );

  const deposit = useCallback(
    (market: MarketView, side: Side, amount: bigint) =>
      run(
        market,
        "deposit",
        "Deposit",
        `${fmtUsdx(amount)} USDX placed on ${SIDE_META[side].label}.`,
        () =>
          writer!.methods
            .deposit(SIDE_ARG[side], new BN(amount.toString()))
            .accountsPartial({
              user: publicKey!,
              market: market.address,
              position: positionPda(market.address, publicKey!, side),
              vault: market.vault,
              userTokenAccount: quoteAta(publicKey!),
              quoteMint: market.quoteMint,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
      ),
    [run, writer, publicKey],
  );

  const withdraw = useCallback(
    (market: MarketView, side: Side, amount: bigint) =>
      run(
        market,
        "withdraw",
        "Withdraw",
        `${fmtUsdx(amount)} USDX returned to your wallet.`,
        () =>
          writer!.methods
            .withdraw(new BN(amount.toString()))
            .accountsPartial({
              user: publicKey!,
              market: market.address,
              position: positionPda(market.address, publicKey!, side),
              vault: market.vault,
              userTokenAccount: quoteAta(publicKey!),
              quoteMint: market.quoteMint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
      ),
    [run, writer, publicKey],
  );

  const claim = useCallback(
    (market: MarketView, side: Side, expected: bigint) =>
      run(
        market,
        "claim",
        "Claim",
        expected > 0n ? `${fmtUsdx(expected)} USDX collected.` : "Position closed.",
        () => {
          const ata = quoteAta(publicKey!);
          return writer!.methods
            .claim()
            .accountsPartial({
              user: publicKey!,
              market: market.address,
              position: positionPda(market.address, publicKey!, side),
              vault: market.vault,
              userTokenAccount: ata,
              quoteMint: market.quoteMint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            // Harmless when the account already exists, and it always should.
            .preInstructions([
              createAssociatedTokenAccountIdempotentInstruction(
                publicKey!,
                ata,
                publicKey!,
                market.quoteMint,
              ),
            ])
            .rpc();
        },
      ),
    [run, writer, publicKey],
  );

  const isPending = useCallback(
    (market: MarketView, kind?: ActionKind) =>
      kind ? pending === `${market.key}:${kind}` : pending?.startsWith(`${market.key}:`) === true,
    [pending],
  );

  return { deposit, withdraw, claim, pending, isPending };
}
