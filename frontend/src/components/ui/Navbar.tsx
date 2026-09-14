"use client";

// =============================================================================
// Navigation bar
// =============================================================================
//
//   56px sticky header, hairline bottom border, blurred near-black backdrop.
//   Wordmark, network pill, two links, the New York clock with the session
//   state, and the wallet. Below md the links and the clock collapse into a
//   drawer.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Menu, Wallet, X } from "lucide-react";

import { fmtEtClock, sessionStatus } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";

import WalletButton from "./WalletButton";

const NAV_ITEMS = [
  { href: "/", label: "Portfolio", icon: Wallet },
  { href: "/trading", label: "Trading", icon: BarChart3 },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // A market page belongs to the trading section.
  if (href === "/trading") return pathname.startsWith("/trading") || pathname.startsWith("/market");
  return pathname.startsWith(href);
}

/** The New York clock and whether the session is trading. */
function SessionClock() {
  const now = useNow();
  if (!now) return <div className="h-4 w-32 skeleton" />;
  const at = new Date(now * 1000);
  const status = sessionStatus(at);
  return (
    <div className="flex items-center gap-2.5 text-[12px] font-medium" title={status.nextLabel}>
      <span className={cn("status-dot", !status.open && "idle")} />
      <span className="font-mono tabular text-text-1">{fmtEtClock(at)}</span>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-4">ET</span>
      <span className="text-text-2">{status.label}</span>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header className="sticky top-0 z-50 border-b border-line-1 bg-[#06070A]/85 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label="MoveX Equities home"
          >
            <Image src="/logo.png" alt="MoveX" width={110} height={27} className="h-[22px] w-auto" priority />
            <span className="hidden border-l border-line-2 pl-2.5 font-display text-[13px] font-medium tracking-[0.02em] text-text-2 sm:inline">
              Equities
            </span>
          </Link>
          <span className="hidden h-5 items-center rounded-sm border border-line-2 px-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-text-3 sm:inline-flex">
            Devnet
          </span>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
                  active ? "bg-white/[0.07] text-text-1" : "text-text-2 hover:bg-white/[0.03] hover:text-text-1",
                )}
              >
                <item.icon size={13} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-3 lg:flex">
            <SessionClock />
            <span className="h-4 w-px bg-line-2" />
          </div>
          <WalletButton />
          <button
            type="button"
            onClick={toggleMenu}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line-2 bg-white/[0.03] text-text-1 transition-colors hover:bg-white/[0.07] md:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 top-14 z-40 bg-black/40 md:hidden"
              onClick={closeMenu}
              aria-hidden
            />
            <motion.div
              key="drawer"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute inset-x-0 top-14 z-50 border-t border-line-1 bg-[#06070A]/95 shadow-2xl backdrop-blur-lg md:hidden"
            >
              <div className="flex flex-col gap-1 px-4 py-3">
                {NAV_ITEMS.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeMenu}
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                        active ? "bg-white/[0.07] text-text-1" : "text-text-2 hover:bg-white/[0.03] hover:text-text-1",
                      )}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                <div className="mt-2 border-t border-line-1 pt-3">
                  <SessionClock />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
