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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { WalletNotReadyError, WalletReadyState, type WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { rpcEndpoint, wsEndpoint } from "@/lib/config";
import { ProgramProvider } from "@/hooks/useProgram";
import { toast } from "@/store/toast";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * The modal only selects a wallet; the provider connects it only if the
 * wallet is installed or loadable. Picking one that is not here (no
 * extension, disabled, a mobile browser that is not the wallet's own) used
 * to select it and do nothing, and picking it again was then a no-op. This
 * clears that selection and says why, or on mobile opens the page inside
 * Phantom's own browser.
 */
function WalletGuard() {
  const { wallet, connected, select } = useWallet();
  useEffect(() => {
    if (!wallet || connected || wallet.readyState !== WalletReadyState.NotDetected) return;
    // A moment for an extension that registers late before giving up on it.
    const timer = setTimeout(() => {
      const name = wallet.adapter.name;
      select(null);
      if (name === "Phantom" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const url = encodeURIComponent(window.location.href);
        const ref = encodeURIComponent(window.location.origin);
        window.location.href = `https://phantom.app/ul/browse/${url}?ref=${ref}`;
        return;
      }
      toast.warning(
        `${name} was not found in this browser. Install or enable the extension, or open this page in the ${name} app.`,
        `${name} not detected`,
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [wallet, connected, select]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  // Resolved once on the client, where the proxy's own origin is known.
  const endpoint = useMemo(() => rpcEndpoint(), []);
  const connectionConfig = useMemo(
    () => ({ commitment: "confirmed" as const, wsEndpoint: wsEndpoint() }),
    [],
  );

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

  // Wallet errors surface as toasts instead of only the console. Not-ready is
  // explained by WalletGuard, and a closed wallet prompt needs no message.
  const onWalletError = useCallback((error: WalletError) => {
    if (error instanceof WalletNotReadyError) return;
    if (/reject|cancel/i.test(error.message)) return;
    toast.error(error.message || "The wallet could not connect.", "Wallet error");
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
        <WalletGuard />
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <ProgramProvider>{children}</ProgramProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
