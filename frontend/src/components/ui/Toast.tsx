"use client";

// =============================================================================
// Toasts
// =============================================================================
//
// Rendered once in the root layout. Anything can raise one through the
// store; transaction hooks do, with an explorer link on success.

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToastStore, type Toast, type ToastVariant } from "@/store/toast";

const VARIANT: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; accent: string; border: string; bar: string }
> = {
  success: {
    icon: CheckCircle2,
    accent: "text-brand",
    border: "border-brand/20",
    bar: "bg-brand",
  },
  error: {
    icon: XCircle,
    accent: "text-loss",
    border: "border-loss/25",
    bar: "bg-loss",
  },
  warning: {
    icon: AlertTriangle,
    accent: "text-warning",
    border: "border-warning/25",
    bar: "bg-warning",
  },
  info: {
    icon: Info,
    accent: "text-info",
    border: "border-info/25",
    bar: "bg-info",
  },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const v = VARIANT[toast.variant];
  const Icon = v.icon;

  // Keyed on the id only: the dismiss callback is a fresh arrow each render
  // and would otherwise reset the timer forever.
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "relative flex items-start gap-3 w-[min(360px,calc(100vw-32px))] rounded-md border bg-surface-1/95 px-4 py-3",
        "shadow-2xl shadow-black/50 backdrop-blur-md overflow-hidden",
        v.border,
      )}
      role="status"
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-[2px]", v.bar)} />
      <Icon size={17} className={cn("mt-0.5 shrink-0", v.accent)} />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase text-text-1 mb-0.5">
            {toast.title}
          </p>
        )}
        <p className="text-[12.5px] text-text-2 leading-relaxed break-words">{toast.message}</p>
        {toast.link && (
          <a
            href={toast.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase text-brand hover:underline"
          >
            {toast.link.label}
            <ExternalLink size={10} />
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 mt-0.5 text-text-4 hover:text-text-1 transition-colors"
      >
        <X size={14} />
      </button>
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: toast.duration / 1000, ease: "linear" }}
        className={cn("absolute bottom-0 left-0 right-0 h-[2px] origin-left opacity-40", v.bar)}
      />
    </motion.div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
