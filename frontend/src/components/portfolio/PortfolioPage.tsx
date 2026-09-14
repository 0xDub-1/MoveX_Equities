"use client";

// =============================================================================
// Portfolio page
// =============================================================================
//
// Wallet, faucet, a strip of totals and every position, all read from chain
// for the connected wallet. With no wallet it explains what it would show.

import { useMemo, type ReactNode } from "react";

import type { MarketView } from "@/lib/market";
import { useBalances } from "@/hooks/useBalances";
import { useFaucet } from "@/hooks/useFaucet";
import { useMarketActions } from "@/hooks/useMarketActions";
import { useMarkets } from "@/hooks/useMarkets";
import { useNow } from "@/hooks/useNow";
import { usePositions } from "@/hooks/usePositions";
import { usePriceFeeds } from "@/hooks/usePriceFeeds";
import { useProgram } from "@/hooks/useProgram";
import { Eyebrow } from "@/components/ui/primitives";

import ConnectHero from "./ConnectHero";
import FaucetCard from "./FaucetCard";
import KpiStrip, { computeKpis } from "./KpiStrip";
import PositionsTable from "./PositionsTable";
import WalletCard from "./WalletCard";
import { buildRows } from "./rows";

function Container({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      {children}
    </div>
  );
}

export default function PortfolioPage() {
  const { publicKey } = useProgram();
  const now = useNow();
  const balances = useBalances(publicKey);
  const faucet = useFaucet(publicKey);
  const positions = usePositions(publicKey);
  const markets = useMarkets();
  const feeds = usePriceFeeds();
  const actions = useMarketActions();

  const marketByKey = useMemo(() => {
    const map = new Map<string, MarketView>();
    for (const market of markets.data ?? []) map.set(market.key, market);
    return map;
  }, [markets.data]);

  const rows = useMemo(
    () => buildRows(positions.data, marketByKey, now),
    [positions.data, marketByKey, now],
  );
  const kpis = useMemo(() => computeKpis(rows), [rows]);

  // Before the clock ticks a phase is a guess, so the page waits for it too.
  const loading = now === 0 || positions.isPending || markets.isPending;
  const error = !loading && (positions.isError || markets.isError) && (!positions.data || !markets.data);

  if (!publicKey) {
    return (
      <Container>
        <ConnectHero faucet={faucet.data} />
      </Container>
    );
  }

  const count = rows.length;

  return (
    <Container>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Devnet · read from chain</Eyebrow>
          <h1 className="font-display text-[22px] font-semibold leading-none tracking-tight text-text-1 sm:text-[26px]">
            Portfolio
          </h1>
        </div>
        {!loading && !error && (
          <p className="font-mono text-[11px] tabular text-text-3">
            {count} position{count === 1 ? "" : "s"} on this wallet
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <WalletCard address={publicKey.toBase58()} balances={balances.data} loading={balances.isPending} />
        <FaucetCard faucet={faucet} sol={balances.data?.sol} now={now} />
      </div>

      <KpiStrip kpis={kpis} loading={loading} />

      <PositionsTable
        rows={rows}
        loading={loading}
        error={error}
        retrying={positions.isFetching || markets.isFetching}
        onRetry={() => {
          void positions.refetch();
          void markets.refetch();
        }}
        feeds={feeds.data}
        now={now}
        actions={actions}
      />
    </Container>
  );
}
