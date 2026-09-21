import type { Metadata } from "next";

import PortfolioPage from "@/components/portfolio/PortfolioPage";

export const metadata: Metadata = {
  title: { absolute: "MoveX · Portfolio" },
};

/** The home page: the connected wallet's balances, faucet and positions. */
export default function Page() {
  return <PortfolioPage />;
}
