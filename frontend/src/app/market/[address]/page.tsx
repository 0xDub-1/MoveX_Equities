import type { Metadata } from "next";

import MarketPage from "@/components/market/MarketPage";

export const metadata: Metadata = {
  title: "Market",
};

// `params` is a Promise in Next 16. The generated `PageProps<'/market/[address]'>`
// helper only exists once typegen has seen this route, so the shape is spelled
// out here and stays correct either way.
export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <MarketPage address={address} />;
}
