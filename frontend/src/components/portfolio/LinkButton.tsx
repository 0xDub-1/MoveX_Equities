// =============================================================================
// Link button
// =============================================================================
//
// A navigation link dressed as a `Button`, for the places a row needs to
// send the user somewhere rather than sign something. Mirrors the primitive's
// sizes and its three quiet variants so the two sit together in one row.

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-[#06070A] hover:brightness-110 border border-transparent",
  secondary:
    "bg-white/[0.04] text-text-1 border border-line-2 hover:bg-white/[0.07] hover:border-line-3",
  ghost: "bg-transparent text-text-2 border border-transparent hover:text-text-1 hover:bg-white/[0.04]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded",
  md: "h-10 px-4 text-[13px] gap-2 rounded-md",
};

export default function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  external = false,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    "inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-all active:scale-[0.985]",
    VARIANT[variant],
    SIZE[size],
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
