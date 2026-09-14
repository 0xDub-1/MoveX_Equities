"use client";

// =============================================================================
// Wallet button
// =============================================================================
//
// A custom trigger over the wallet adapter modal. The library's own button
// carries its purple styling and a hydration mismatch; this one renders a
// same-sized placeholder until mounted, then either a connect call to
// action or the connected address with a small menu.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, RefreshCw, Wallet } from "lucide-react";

import { explorerAddress } from "@/lib/config";
import { shortKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/useNow";

export default function WalletButton({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  const mounted = useMounted();
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = useCallback(async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard denied. The address is still visible in the menu.
    }
  }, [publicKey]);

  const height = size === "lg" ? "h-11" : "h-9";

  if (!mounted) {
    return <div className={cn(height, "w-[136px] rounded-md bg-white/[0.04]", className)} aria-hidden />;
  }

  if (!connected || !publicKey) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        disabled={connecting}
        className={cn(
          height,
          "inline-flex items-center gap-2 px-3.5 rounded-md bg-brand text-[#06070A] text-[13px] font-semibold",
          "hover:brightness-110 active:scale-[0.985] transition-all disabled:opacity-60",
          className,
        )}
      >
        <Wallet size={14} />
        {connecting ? "Connecting" : "Connect wallet"}
      </button>
    );
  }

  const address = publicKey.toBase58();

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          height,
          "inline-flex items-center gap-2 pl-2 pr-2.5 rounded-md border border-line-2 bg-white/[0.03]",
          "text-[12.5px] font-medium text-text-1 hover:bg-white/[0.06] hover:border-line-3 transition-colors",
        )}
      >
        {wallet?.adapter.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.adapter.icon} alt="" className="h-4 w-4 rounded-sm" />
        ) : (
          <Wallet size={14} className="text-brand" />
        )}
        <span className="font-mono tabular">{shortKey(address)}</span>
        <ChevronDown size={13} className={cn("text-text-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-md border border-line-2 bg-surface-1 shadow-2xl shadow-black/60 overflow-hidden"
        >
          <div className="px-3 py-2.5 border-b border-line-1">
            <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-text-3">
              {wallet?.adapter.name ?? "Wallet"} · Devnet
            </p>
            <p className="font-mono text-[11px] text-text-2 mt-1 break-all leading-snug">{address}</p>
          </div>
          <MenuItem onClick={copy} icon={copied ? <Check size={13} className="text-brand" /> : <Copy size={13} />}>
            {copied ? "Copied" : "Copy address"}
          </MenuItem>
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="flex items-center gap-2.5 px-3 h-9 text-[12.5px] text-text-2 hover:text-text-1 hover:bg-white/[0.04] transition-colors"
          >
            <ExternalLink size={13} />
            View on Explorer
          </a>
          <MenuItem
            onClick={() => {
              setOpen(false);
              setVisible(true);
            }}
            icon={<RefreshCw size={13} />}
          >
            Change wallet
          </MenuItem>
          <div className="border-t border-line-1">
            <MenuItem
              onClick={() => {
                setOpen(false);
                void disconnect();
              }}
              icon={<LogOut size={13} />}
              tone="danger"
            >
              Disconnect
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
  tone = "default",
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 h-9 text-[12.5px] transition-colors text-left",
        tone === "danger"
          ? "text-loss/90 hover:text-loss hover:bg-loss/[0.06]"
          : "text-text-2 hover:text-text-1 hover:bg-white/[0.04]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
