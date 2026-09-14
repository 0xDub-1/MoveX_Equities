"use client";

// =============================================================================
// Connect hero
// =============================================================================
//
// The portfolio with no wallet: what the page will show once one is
// connected, and the three things a new devnet user does first.

import type { ReactNode } from "react";

import { SOL_FAUCET_URL } from "@/lib/config";
import { fmtDuration, fmtUsdx } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FaucetState } from "@/hooks/useFaucet";
import WalletButton from "@/components/ui/WalletButton";
import { Eyebrow, InlineLink, Surface } from "@/components/ui/primitives";

export default function ConnectHero({ faucet }: { faucet: FaucetState | undefined }) {
  const drawLine =
    faucet && faucet.amountPerClaim > 0n
      ? `The faucet on this page mints ${fmtUsdx(faucet.amountPerClaim, { decimals: 0 })} USDX per draw, one draw every ${fmtDuration(faucet.cooldownSecs)}.`
      : "The faucet on this page mints test USDX to trade with.";

  const steps: { number: string; title: string; body: ReactNode }[] = [
    {
      number: "01",
      title: "Connect a wallet",
      body: "Phantom or Solflare, switched to Solana devnet.",
    },
    {
      number: "02",
      title: "Get devnet SOL",
      body: (
        <>
          A little SOL pays the transaction fees.{" "}
          <InlineLink href={SOL_FAUCET_URL} external>
            Solana faucet
          </InlineLink>
        </>
      ),
    },
    {
      number: "03",
      title: "Draw USDX, then trade",
      body: drawLine,
    },
  ];

  return (
    <Surface as="section">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-6 py-12 text-center sm:py-16">
        <Eyebrow>Portfolio · Devnet</Eyebrow>
        <h1 className="font-display text-[26px] font-semibold leading-[1.1] tracking-tight text-text-1 sm:text-[34px]">
          Your portfolio lives in your wallet
        </h1>
        <p className="text-[13.5px] leading-relaxed text-text-2">
          Positions, balances and claims are read from the chain every time this page opens.
          Nothing is stored anywhere else, so there is nothing to sign up for.
        </p>
        <WalletButton size="lg" />
      </div>

      <div className="grid border-t border-line-1 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div
            key={step.number}
            className={cn(
              "flex flex-col gap-1.5 px-5 py-4",
              i > 0 && "border-t border-line-1 sm:border-l sm:border-t-0",
            )}
          >
            <span className="w-fit rounded-sm border border-line-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
              {step.number}
            </span>
            <p className="text-[13px] font-medium text-text-1">{step.title}</p>
            <p className="text-[12px] leading-relaxed text-text-3">{step.body}</p>
          </div>
        ))}
      </div>
    </Surface>
  );
}
