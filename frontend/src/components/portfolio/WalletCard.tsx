"use client";

// =============================================================================
// Wallet card
// =============================================================================
//
// The connected address and its two balances. SOL only matters for fees, so
// it gets a nudge when it runs low rather than a headline.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { SOL_FAUCET_URL } from "@/lib/config";
import { fmtNumber, fmtUsdx } from "@/lib/format";
import type { Balances } from "@/hooks/useBalances";
import {
  AddressLink,
  InlineLink,
  SectionHeader,
  Skeleton,
  Stat,
  Surface,
} from "@/components/ui/primitives";

/** Under this much SOL a transaction or two is all that is left. */
const LOW_SOL = 0.01;

function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-28 max-w-full" />
      <Skeleton className="h-2.5 w-24" />
    </div>
  );
}

export default function WalletCard({
  address,
  balances,
  loading,
}: {
  address: string;
  balances: Balances | undefined;
  loading: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard denied. The address is selectable text.
    }
  }, [address]);

  const lowSol = balances !== undefined && balances.sol < LOW_SOL;

  return (
    <Surface as="section">
      <SectionHeader
        number="01"
        label="Wallet"
        trailing={<AddressLink address={address} label="Explorer" />}
      />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 select-all break-all font-mono text-[12px] leading-relaxed text-text-2">
            {address}
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy address"}
            title={copied ? "Copied" : "Copy address"}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line-2 bg-white/[0.02] text-text-3 transition-colors hover:bg-white/[0.06] hover:text-text-1"
          >
            {copied ? <Check size={13} className="text-brand" /> : <Copy size={13} />}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-line-1 pt-4">
          {loading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <Stat
                label="USDX balance"
                size="lg"
                valueClassName="text-brand text-[22px] sm:text-3xl"
                value={balances ? fmtUsdx(balances.usdx) : "--"}
                sub="Test USDX, the quote asset"
              />
              <Stat
                label="SOL balance"
                size="lg"
                valueClassName="text-[22px] sm:text-3xl"
                value={balances ? fmtNumber(balances.sol, 4) : "--"}
                sub="Devnet SOL, pays the fees"
              />
            </>
          )}
        </div>

        {lowSol && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border border-warning/25 bg-warning/[0.06] px-3.5 py-2.5">
            <span className="text-[12px] text-warning">
              Low SOL. Every transaction needs a little devnet SOL for its fee.
            </span>
            <InlineLink href={SOL_FAUCET_URL} external className="text-[12px] font-medium">
              Get devnet SOL
            </InlineLink>
          </div>
        )}

        {balances?.hasTokenAccount === false && (
          <p className="text-[11.5px] leading-relaxed text-text-3">
            No USDX token account yet. The first faucet draw creates it.
          </p>
        )}
      </div>
    </Surface>
  );
}
