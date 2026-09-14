"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/useNow";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  dismissable?: boolean;
}) {
  const mounted = useMounted();

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissable]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm"
            onClick={dismissable ? onClose : undefined}
          />
          <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "pointer-events-auto relative w-full bg-surface-1 border border-line-2 shadow-2xl shadow-black/60 overflow-hidden",
                "rounded-t-lg sm:rounded-lg max-h-[92vh] flex flex-col",
                size === "sm" && "sm:max-w-sm",
                size === "md" && "sm:max-w-md",
                size === "lg" && "sm:max-w-2xl",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {(title || dismissable) && (
                <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
                  <div className="min-w-0">
                    {title && (
                      <h2 className="font-display text-[17px] font-semibold text-text-1 tracking-tight">
                        {title}
                      </h2>
                    )}
                    {subtitle && <p className="text-[12px] text-text-3 mt-1">{subtitle}</p>}
                  </div>
                  {dismissable && (
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close"
                      className="p-1.5 rounded text-text-3 hover:text-text-1 hover:bg-white/[0.05] transition-colors shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}
              <div className="px-5 pb-5 overflow-y-auto">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
