import type { Metadata } from "next";

import TradingPage from "@/components/trading/TradingPage";

export const metadata: Metadata = {
  title: "Trading",
};

export default function Page() {
  return <TradingPage />;
}
