"use client";

// =============================================================================
// UI primitives
// =============================================================================
//
// The small vocabulary every page is built from. Keeping it here, and
// keeping it small, is what makes three pages written on three days look
// like one product.

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { explorerAddress } from "@/lib/config";
import { fmtCountdown, shortKey } from "@/lib/format";
import type { Side, Tier, Tone } from "@/lib/market";
import { SIDE_META, TIER_META } from "@/lib/market";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";

// ---------------------------------------------------------------------------
// Surfaces and headers
// ---------------------------------------------------------------------------

export function Surface({
  children,
  className,
  highlight = true,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag
      className={cn(
        "relative overflow-hidden rounded-lg border border-line-2 bg-surface-1",
        highlight && "surface-highlight",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Mono, uppercase, tracked. The label style used everywhere. */
export function Eyebrow({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "font-mono font-medium uppercase text-text-3",
        size === "sm" ? "text-[10.5px] tracking-[0.14em]" : "text-[11px] tracking-[0.16em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Numbered section header: `01  PORTFOLIO`, with an optional right slot. */
export function SectionHeader({
  number,
  label,
  trailing,
  className,
}: {
  number?: string;
  label: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-line-1 bg-white/[0.015] px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {number && (
          <span className="shrink-0 rounded-sm border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
            {number}
          </span>
        )}
        <span className="truncate font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-text-2">
          {label}
        </span>
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<Tone, string> = {
  brand: "border-brand/30 text-brand bg-brand/[0.07]",
  sky: "border-below/30 text-below bg-below/[0.08]",
  amber: "border-warning/30 text-warning bg-warning/[0.08]",
  rose: "border-loss/30 text-loss bg-loss/[0.08]",
  neutral: "border-line-2 text-text-2 bg-white/[0.03]",
};

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  pulse = false,
  className,
  size = "md",
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border font-mono font-medium uppercase whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[10px] tracking-[0.12em]" : "h-6 px-2 text-[11px] tracking-[0.12em]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            pulse && "animate-pulse-soft",
          )}
        />
      )}
      {children}
    </span>
  );
}

const SIDE_CLASSES: Record<Side, string> = {
  above: "border-above/35 text-above bg-above/[0.08]",
  below: "border-below/35 text-below bg-below/[0.08]",
};

/** ABOVE or BELOW, in its colour. */
export function SideTag({
  side,
  className,
  size = "md",
  muted = false,
}: {
  side: Side;
  className?: string;
  size?: "sm" | "md";
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border font-mono font-semibold uppercase",
        size === "sm" ? "h-5 px-1.5 text-[10px] tracking-[0.12em]" : "h-6 px-2 text-[11px] tracking-[0.12em]",
        muted ? "border-line-2 text-text-3 bg-transparent" : SIDE_CLASSES[side],
        className,
      )}
    >
      {SIDE_META[side].label}
    </span>
  );
}

/** TIGHT, FAIR or WIDE with its percentile. */
export function TierTag({
  tier,
  className,
  active = true,
  showPercentile = false,
}: {
  tier: Tier;
  className?: string;
  active?: boolean;
  showPercentile?: boolean;
}) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-sm border font-mono text-[11px] font-semibold tracking-[0.14em] uppercase",
        active ? "border-line-3 text-text-1 bg-white/[0.04]" : "border-line-1 text-text-3",
        className,
      )}
    >
      {meta.label}
      {showPercentile && <span className="text-text-4 font-medium">{meta.percentile}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "above" | "below" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-[#06070A] hover:brightness-110 border border-transparent",
  secondary:
    "bg-white/[0.04] text-text-1 border border-line-2 hover:bg-white/[0.07] hover:border-line-3",
  ghost: "bg-transparent text-text-2 border border-transparent hover:text-text-1 hover:bg-white/[0.04]",
  above: "bg-above text-[#06070A] hover:brightness-110 border border-transparent",
  below: "bg-below text-[#06070A] hover:brightness-110 border border-transparent",
  danger: "bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded",
  md: "h-10 px-4 text-[13px] gap-2 rounded-md",
  lg: "h-12 px-5 text-[14px] gap-2 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, block = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-all",
        "active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 size={size === "sm" ? 13 : 15} className="animate-spin" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  sub,
  align = "left",
  size = "md",
  valueClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  align?: "left" | "right" | "center";
  size?: "sm" | "md" | "lg";
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 min-w-0",
        align === "right" && "items-end text-right",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <Eyebrow size="sm">{label}</Eyebrow>
      <span
        className={cn(
          "tabular font-semibold text-text-1 tracking-tight leading-none",
          size === "sm" && "text-[13px]",
          size === "md" && "text-[15px]",
          size === "lg" && "font-display text-2xl sm:text-3xl",
          valueClassName,
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-text-3 leading-snug">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Inside this many seconds a countdown turns amber, so it catches the eye. */
export const URGENT_SECONDS = 15 * 60;

/** Live countdown to a unix timestamp. Renders the done label once it passes. */
export function Countdown({
  to,
  className,
  prefix,
  done = "Now",
  urgentBelow = URGENT_SECONDS,
}: {
  to: number;
  className?: string;
  prefix?: ReactNode;
  done?: ReactNode;
  /** Seconds under which the value turns amber. Pass 0 to never do that. */
  urgentBelow?: number;
}) {
  const now = useNow();
  if (!now) return <span className={cn("tabular", className)}>&nbsp;</span>;
  const remaining = to - now;
  const urgent = remaining > 0 && remaining <= urgentBelow;
  return (
    // The urgent class sits after `className` so it wins the merge.
    <span className={cn("tabular", className, urgent && "font-semibold text-warning")}>
      {prefix}
      {remaining > 0 ? fmtCountdown(remaining) : done}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-line-1 bg-surface-0/60 p-0.5 gap-0.5",
        className,
      )}
      role="tablist"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded font-medium transition-colors whitespace-nowrap",
              size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-[12.5px]",
              active ? "bg-white/[0.08] text-text-1" : "text-text-3 hover:text-text-1",
            )}
          >
            {o.label}
            {typeof o.count === "number" && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular",
                  active ? "text-brand" : "text-text-4",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      {icon && (
        <div className="w-11 h-11 rounded-sm border border-line-2 mx-auto flex items-center justify-center mb-4 text-text-4">
          {icon}
        </div>
      )}
      <p className="text-[14px] font-medium text-text-1">{title}</p>
      {body && <p className="text-[12.5px] text-text-3 mt-1.5 max-w-md mx-auto leading-relaxed">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** An address, shortened, linking to the explorer. */
export function AddressLink({
  address,
  chars = 4,
  className,
  label,
}: {
  address: string;
  chars?: number;
  className?: string;
  label?: string;
}) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] text-text-3 hover:text-brand transition-colors tabular",
        className,
      )}
      title={address}
    >
      {label ?? shortKey(address, chars)}
      <ExternalLink size={10} />
    </a>
  );
}

export function InlineLink({
  href,
  children,
  className,
  external = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  external?: boolean;
}) {
  const classes = cn(
    "inline-flex items-center gap-1 text-brand hover:underline underline-offset-2",
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
        <ExternalLink size={11} />
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
