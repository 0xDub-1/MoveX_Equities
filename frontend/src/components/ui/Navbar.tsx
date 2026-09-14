"use client";

// =============================================================================
// Navigation bar
// =============================================================================
//
//   56px sticky header, hairline bottom border, blurred near-black backdrop.
//   Wordmark, network pill, two links, the New York clock with the session
//   state, oracle health, and the wallet. Below md the links and status
//   collapse into a drawer.

import { useCallback, useEffect, useState } from "react";
// The Escape key handler below is the one effect this component keeps.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Menu, Wallet, X } from "lucide-react";

import { fmtEtClock, sessionStatus } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import { useFeedHealth } from "@/hooks/usePriceFeeds";

import WalletButton from "./WalletButton";

const NAV_ITEMS = [
  { href: "/", label: "Trading", icon: BarChart3 },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/market");
  return pathname.startsWith(href);
}

/** The New York clock and whether the session is trading. */
function SessionClock({ compact = false }: { compact?: boolean }) {
  const now = useNow();
  if (!now) return <div className="h-4 w-28 skeleton" />;
  const at = new Date(now * 1000);
  const status = sessionStatus(at);
  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.12em] uppercase text-text-2"
      title={status.nextLabel}
    >
      <span className={cn("status-dot", !status.open && "idle")} />
      <span className="tabular text-text-1">{fmtEtClock(at)}</span>
      <span className="text-text-4">ET</span>
      {!compact && <span className="text-text-3">{status.label}</span>}
    </div>
  );
}

function OracleHealth() {
  const now = useNow();
  const health = useFeedHealth(now);
  const tone = health.allFresh ? "" : health.anyFresh ? "idle" : "offline";
  const label = health.allFresh ? "Oracle live" : health.anyFresh ? "Oracle partial" : "Oracle idle";
  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.12em] uppercase text-text-2"
      title={`${health.fresh} of ${health.total} feeds published in the last two minutes`}
    >
      <span className={cn("status-dot", tone)} />
      <span>{label}</span>
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
    <header className="sticky top-0 z-50 bg-[#06070A]/85 backdrop-blur-md border-b border-line-1">
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 gap-3">
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity" aria-label="MoveX Equities home">
            <Image src="/logo.png" alt="MoveX" width={110} height={27} className="h-[22px] w-auto" priority />
            <span className="hidden sm:inline font-display text-[13px] font-medium tracking-[0.02em] text-text-2 border-l border-line-2 pl-2.5">
              Equities
            </span>
          </Link>
          <span className="hidden sm:inline-flex items-center h-5 px-1.5 rounded-sm border border-line-2 font-mono text-[9px] font-medium tracking-[0.18em] uppercase text-text-3">
            Devnet
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium transition-colors",
                  active ? "bg-white/[0.06] text-text-1" : "text-text-2 hover:text-text-1 hover:bg-white/[0.03]",
                )}
              >
                <item.icon size={13} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-4">
            <SessionClock />
            <span className="h-4 w-px bg-line-2" />
            <OracleHealth />
            <span className="h-4 w-px bg-line-2" />
          </div>
          <WalletButton />
          <button
            type="button"
            onClick={toggleMenu}
            className="md:hidden flex items-center justify-center h-9 w-9 rounded-md border border-line-2 bg-white/[0.03] text-text-1 hover:bg-white/[0.07] transition-colors"
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
              className="absolute inset-x-0 top-14 z-50 md:hidden border-t border-line-1 bg-[#06070A]/95 backdrop-blur-lg shadow-2xl"
            >
              <div className="px-4 py-3 flex flex-col gap-1">
                {NAV_ITEMS.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeMenu}
                      className={cn(
                        "flex items-center gap-3 h-11 px-3 rounded-md text-sm font-medium transition-colors",
                        active ? "bg-white/[0.06] text-text-1" : "text-text-2 hover:text-text-1 hover:bg-white/[0.03]",
                      )}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                <div className="mt-2 pt-3 border-t border-line-1 flex flex-col gap-2.5">
                  <SessionClock />
                  <OracleHealth />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
