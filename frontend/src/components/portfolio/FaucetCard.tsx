"use client";

// =============================================================================
// Faucet card
// =============================================================================
//
// The program's own USDX faucet. Everything shown comes from the faucet
// account, so a change to the allowance on chain shows up here unedited.

import { fmtDuration, fmtUsdx } from "@/lib/format";
import type { useFaucet } from "@/hooks/useFaucet";
import {
  Button,
  Countdown,
  SectionHeader,
  Skeleton,
  Stat,
  Surface,
} from "@/components/ui/primitives";

type Faucet = ReturnType<typeof useFaucet>;

function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-2.5 w-14" />
      <Skeleton className="h-4 w-20 max-w-full" />
      <Skeleton className="h-2.5 w-12" />
    </div>
  );
}

export default function FaucetCard({
  faucet,
  sol,
  now,
}: {
  faucet: Faucet;
  /** The wallet's SOL balance, undefined until read. */
  sol: number | undefined;
  now: number;
}) {
  const data = faucet.data;
  const amountLabel = data && data.amountPerClaim > 0n ? fmtUsdx(data.amountPerClaim, { decimals: 0 }) : null;
  const missing = data !== undefined && !data.exists;
  const noSol = sol !== undefined && sol <= 0;
  const cooling = now > 0 && faucet.readyAt > now;

  let hint: string | null = null;
  if (missing) hint = "The faucet is not initialized on this deployment.";
  else if (noSol) hint = "Needs devnet SOL for the transaction fee.";

  const disabled = !data || missing || noSol || cooling;

  const draw = () => {
    // The hook reports success and failure through toasts.
    faucet.claim().catch(() => undefined);
  };

  return (
    <Surface as="section">
      <SectionHeader number="02" label="USDX faucet" />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-3">
          {data ? (
            <>
              <Stat label="Per draw" value={amountLabel ?? "--"} sub="USDX" />
              <Stat label="Cooldown" value={fmtDuration(data.cooldownSecs)} sub="Between draws" />
              <Stat
                label="Total drawn"
                value={fmtUsdx(data.totalClaimed, { decimals: 0 })}
                sub="USDX, this wallet"
              />
            </>
          ) : (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="primary" block loading={faucet.claiming} disabled={disabled} onClick={draw}>
            {cooling ? (
              <Countdown to={faucet.readyAt} prefix="Ready in " />
            ) : amountLabel ? (
              `Draw ${amountLabel} USDX`
            ) : (
              "Draw USDX"
            )}
          </Button>
          {hint && (
            <p className="font-mono text-[11.5px] text-warning">{hint}</p>
          )}
        </div>

        <p className="text-[11.5px] leading-relaxed text-text-3">
          USDX is a test token on Solana devnet with no value. Every market on MoveX is denominated in it.
        </p>
      </div>
    </Surface>
  );
}
