import type { Metadata } from "next";

import TradingPage from "@/components/trading/TradingPage";

export const metadata: Metadata = {
  title: "Crypto",
  description:
    "Volatility markets on BTC, ETH and SOL, midnight to midnight and hour by hour in UTC, around the clock, settled on Solana.",
};

/** The crypto board: BTC, ETH and SOL, around the clock in UTC. */
export default function Page() {
  return <TradingPage venue="crypto" />;
}
