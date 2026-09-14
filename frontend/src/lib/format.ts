// =============================================================================
// Number formatting
// =============================================================================
//
// Every formatter pins `en-US`, so server and client render the same string
// and hydration never disagrees over a thousands separator.

import type { PublicKey } from "@solana/web3.js";

import { QUOTE_DECIMALS } from "./config";

const cache = new Map<string, Intl.NumberFormat>();

function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    cache.set(key, f);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Token amounts
// ---------------------------------------------------------------------------

/** Base units to a float. Fine for display; never for arithmetic. */
export function fromBase(base: bigint, decimals = QUOTE_DECIMALS): number {
  return Number(base) / 10 ** decimals;
}

/**
 * A user-typed decimal string to base units, without going through a float.
 * `"12.5"` becomes `12_500_000n`. Returns null for anything that is not a
 * plain non-negative decimal.
 */
export function toBase(input: string, decimals = QUOTE_DECIMALS): bigint | null {
  const text = input.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(text) || text === "" || text === ".") return null;
  const [whole = "0", frac = ""] = text.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

/** `12,345.67`, or `12.3K` when compact and large. */
export function fmtUsdx(base: bigint, opts: { compact?: boolean; decimals?: number } = {}): string {
  const value = fromBase(base);
  if (opts.compact && Math.abs(value) >= 10_000) return fmtCompact(value);
  const d = opts.decimals ?? 2;
  return nf(d, d).format(value);
}

/** `+1,234.56` or `-1,234.56`. */
export function fmtUsdxSigned(base: bigint): string {
  const sign = base > 0n ? "+" : base < 0n ? "-" : "";
  return `${sign}${fmtUsdx(base < 0n ? -base : base)}`;
}

export function fmtNumber(value: number, decimals = 2): string {
  return nf(decimals, decimals).format(value);
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${nf(1, 1).format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${nf(1, 1).format(value / 1_000)}K`;
  return nf(0, 2).format(value);
}

// ---------------------------------------------------------------------------
// Prices and percentages
// ---------------------------------------------------------------------------

/** A price float as `$178.42`. */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return `$${nf(digits, digits).format(value)}`;
}

/** `1.55%`, optionally with an explicit sign. */
export function fmtPct(value: number, opts: { decimals?: number; signed?: boolean } = {}): string {
  const d = opts.decimals ?? 2;
  const sign = opts.signed && value > 0 ? "+" : "";
  return `${sign}${nf(d, d).format(value)}%`;
}

/** Basis points as a percentage: 155 becomes `1.55%`. */
export function fmtBps(bps: number, decimals = 2): string {
  return fmtPct(bps / 100, { decimals });
}

/** A payout multiple as `1.43x`. */
export function fmtMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${nf(2, 2).format(value)}x`;
}

// ---------------------------------------------------------------------------
// Keys and time
// ---------------------------------------------------------------------------

export function shortKey(key: PublicKey | string, chars = 4): string {
  const s = key.toString();
  return `${s.slice(0, chars)}…${s.slice(-chars)}`;
}

/**
 * A countdown at the precision that matters: `2d 4h`, `15h 10m`, `41m`,
 * and seconds only inside the last ten minutes, `9m 46s`. Never negative.
 */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const mins = Math.floor((s % 3_600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  if (mins >= 10) return `${mins}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/** A pool share as the crowd's implied chance: 0.57 becomes `57%`. */
export function fmtChance(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Coarse duration for labels: `1h`, `24h`, `45m`, `2d`. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86_400) return `${Math.round(s / 86_400)}d`;
  if (s >= 3_600) return `${Math.round(s / 3_600)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

/** `42s ago`, `3m ago`, `2h ago`. */
export function fmtAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
