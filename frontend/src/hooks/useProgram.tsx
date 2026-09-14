"use client";

// =============================================================================
// Program context
// =============================================================================
//
// One read-only program handle for everyone, and one bound to the connected
// wallet for whoever is signing. Both are memoised on the connection and the
// wallet so a re-render never rebuilds the Anchor client.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";

import { createProgram, type MovexProgram } from "@/lib/program";

interface ProgramContextValue {
  reader: MovexProgram;
  writer: MovexProgram | null;
}

const ProgramContext = createContext<ProgramContextValue | null>(null);

export function ProgramProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const reader = useMemo(() => createProgram(connection), [connection]);
  const writer = useMemo(
    () => (wallet ? createProgram(connection, wallet) : null),
    [connection, wallet],
  );

  const value = useMemo(() => ({ reader, writer }), [reader, writer]);
  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
}

export interface ProgramHandle {
  /** Always available, even with no wallet. */
  reader: MovexProgram;
  /** Bound to the connected wallet, or null. */
  writer: MovexProgram | null;
  publicKey: PublicKey | null;
  connected: boolean;
}

export function useProgram(): ProgramHandle {
  const ctx = useContext(ProgramContext);
  if (!ctx) throw new Error("useProgram must be used inside ProgramProvider");
  const { publicKey, connected } = useWallet();
  return { reader: ctx.reader, writer: ctx.writer, publicKey, connected };
}
