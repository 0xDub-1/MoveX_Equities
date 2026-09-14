"use client";

// =============================================================================
// Client providers
// =============================================================================
//
//   ConnectionProvider   one RPC connection for the whole app
//   WalletProvider       wallet-standard wallets plus Phantom and Solflare
//                        adapters for deep links on mobile
//   WalletModalProvider  the connect dialog, restyled in globals.css
//   QueryClientProvider  polling and caching of every on-chain read
//   ProgramProvider      the Anchor handles built from the two above

import { useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RPC_URL } from "@/lib/config";
import { ProgramProvider } from "@/hooks/useProgram";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  // One client per browser tab. Created lazily so the server never shares
  // a cache between requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 4_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <ProgramProvider>{children}</ProgramProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
