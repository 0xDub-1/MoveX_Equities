"use client";

// =============================================================================
// 06 Details
// =============================================================================
//
// The addresses and constants behind the market, for anyone who wants to
// check the chain rather than trust the page.

import type { ReactNode } from "react";

import { MIN_DEPOSIT_BASE, QUOTE_SYMBOL, VOID_GRACE_SECS } from "@/lib/config";
import { fmtDuration, fmtUsdx } from "@/lib/format";
import type { MarketView } from "@/lib/market";
import { AddressLink, SectionHeader, Surface } from "@/components/ui/primitives";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 sm:px-5 py-2.5 font-mono text-[11px] tabular">
      <dt className="text-text-3">{label}</dt>
      <dd className="min-w-0 text-right text-text-2">{children}</dd>
    </div>
  );
}

export default function MarketDetails({ market }: { market: MarketView }) {
  return (
    <Surface as="section">
      <SectionHeader number="06" label="Details" />

      <dl className="divide-y divide-line-1 py-1">
        <Row label="Market">
          <AddressLink address={market.key} chars={6} />
        </Row>
        <Row label="Vault">
          <AddressLink address={market.vault.toBase58()} chars={6} />
        </Row>
        <Row label="Price feed">
          <AddressLink address={market.priceFeed.toBase58()} chars={6} />
        </Row>
        <Row label="Session">{market.sessionId}</Row>
        <Row label="Fee">{market.feeBps} bps of the pot</Row>
        <Row label="Minimum deposit">
          {fmtUsdx(MIN_DEPOSIT_BASE, { decimals: 0 })} {QUOTE_SYMBOL}
        </Row>
        <Row label="Void grace">{fmtDuration(VOID_GRACE_SECS)} after the settle time</Row>
      </dl>

      <p className="border-t border-line-1 px-4 sm:px-5 py-3 text-[12px] text-text-3">
        Settlement is permissionless: anyone can crank lock and settle once the time has passed.
      </p>
    </Surface>
  );
}
