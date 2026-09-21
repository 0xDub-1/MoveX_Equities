import type { Metadata } from "next";

import TradingPage from "@/components/trading/TradingPage";

export const metadata: Metadata = {
  title: "Equities",
  description:
    "Volatility markets on tokenized US equities, close to close and hour by hour on the NYSE session, settled on Solana.",
};

/** The equities board: NVDA, TSLA and SPY on New York time. */
export default function Page() {
  return <TradingPage venue="equities" />;
}
