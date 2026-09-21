// =============================================================================
// Preflight
// =============================================================================
//
// Runs the lambdas' own code paths locally, so a failure in SSM access or PDA
// derivation surfaces now rather than at 09:00 tomorrow, where it would look
// identical to "the market is closed today" and cost a morning.
//
//   npx tsx scripts/preflight.ts
//
// Credentials come from ~/.aws locally and from the execution role in Lambda,
// so this proves the code but not the IAM policy. That is checked separately
// against the synthesised template.

import { PublicKey } from "@solana/web3.js";

import {
  easternDate,
  easternMinutes,
  hourlySlots,
  isTradingDay,
  nextTradingDay,
  closeMinutes,
} from "../lib/lambdas/shared/calendar";
import { PUBLISHED_TICKERS, HOURLY_TICKER } from "../lib/lambdas/shared/config";
import { CRYPTO_ASSETS, coinOf } from "../lib/lambdas/shared/crypto-config";
import { allMids, midToQuote } from "../lib/lambdas/shared/hyperliquid";
import { getKeypair, getProgram, priceFeedPda, marketPda } from "../lib/lambdas/shared/solana";
import { liveQuote } from "../lib/lambdas/shared/quotes";
import { hourlySlotsAhead } from "../lib/lambdas/shared/utc-sessions";

const EXPECTED_AUTHORITY = "D363Wv9sERq5CyumJJbmu7AAe93Lwk9nrTaXsaxf5M2u";

/** Feeds opened by init-feeds.ts, to confirm derivation agrees with reality. */
const KNOWN_FEEDS: Record<string, string> = {
  NVDA: "4rcRkTKRUNrVfE3T2PVfrkyMPJQenb7nbEQ3tQ5ktw9N",
  TSLA: "AZvWkUvJzzgbjJXAqPk5WoxnBummhpDzgzCv6udxuU7Y",
  SPY: "7EByBMPVYZi3Yz1vnGABe1E7eevXCtEJdWSMUnARLWC6",
  BTC: "BA3NNPJMEFv8FFSETciNsHDKGhhEKcbGXCBEZ5xaLr6s",
  ETH: "9rZMrfkDGHWJC7Zdzxwys8vQq4di8MX3JGJpkj4akP4R",
  SOL: "BZwxb5w5Xt459vpqCmeWj8i3DvDckp9pQkTZGQq93hyW",
};

const nowSecFor = (at: Date) => Math.floor(at.getTime() / 1000);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log("\n=== 1. keypair from parameter store ===");
  const keypair = await getKeypair();
  const authority = keypair.publicKey.toBase58();
  check("read and decoded", true, authority);
  check(
    "matches the account that deployed the program",
    authority === EXPECTED_AUTHORITY,
    authority === EXPECTED_AUTHORITY ? "" : `expected ${EXPECTED_AUTHORITY}`,
  );

  console.log("\n=== 2. program and rpc ===");
  const program = await getProgram();
  check("program built", true, program.programId.toBase58());
  const slot = await program.provider.connection.getSlot();
  check("rpc reachable", slot > 0, `slot ${slot}`);
  const balance = await program.provider.connection.getBalance(keypair.publicKey);
  check("publisher can pay fees", balance > 0.05 * 1e9, `${balance / 1e9} SOL`);

  console.log("\n=== 3. price feed derivation against the chain ===");
  const cryptoSymbols = CRYPTO_ASSETS.map((a) => a.symbol);
  for (const ticker of [...PUBLISHED_TICKERS, ...cryptoSymbols]) {
    const derived = priceFeedPda(program.programId, ticker);
    const expected = KNOWN_FEEDS[ticker];
    check(`${ticker} pda`, derived.toBase58() === expected, derived.toBase58());

    const info = await program.provider.connection.getAccountInfo(derived);
    check(`${ticker} account exists`, info !== null);

    if (info) {
      const accounts = program.account as unknown as {
        priceFeed: { fetch(a: PublicKey): Promise<any> };
      };
      const feed = await accounts.priceFeed.fetch(derived);
      const publisher = new PublicKey(feed.publisher).toBase58();
      check(
        `${ticker} publisher is us`,
        publisher === authority,
        publisher === authority ? "" : publisher,
      );
      const age =
        Number(feed.publishTime) === 0
          ? "never published"
          : `${Math.round((Date.now() / 1000 - Number(feed.publishTime)) / 60)}m old`;
      console.log(`        price ${feed.price.toString()}  ${age}`);
    }
  }

  console.log("\n=== 4. calendar, for today ===");
  const today = easternDate();
  const trading = isTradingDay(today);
  console.log(`        ${today}, ${easternMinutes()} minutes past ET midnight`);
  check("calendar answers for today", true, trading ? "trading day" : "no session");
  const next = nextTradingDay(today);
  check("next session resolves", Boolean(next), next);
  if (trading) {
    check("session close known", closeMinutes(today) > 0, `${closeMinutes(today)} min`);
  }

  console.log("\n=== 5. hourly slots for the next session ===");
  const slots = hourlySlots(next);
  check("slots generated", slots.length > 0, `${slots.length} on ${next}`);
  for (const slot of slots) {
    const market = marketPda(program.programId, HOURLY_TICKER, slot.sessionId, "fair");
    const exists = await program.provider.connection.getAccountInfo(market);
    console.log(
      `        ${slot.sessionId}  lock ${slot.lockMinutes / 60}:00  ` +
        `${exists ? "already created" : "not yet"}  ${market.toBase58()}`,
    );
  }

  console.log("\n=== 6. quote source ===");
  for (const ticker of PUBLISHED_TICKERS) {
    try {
      const quote = await liveQuote(ticker);
      const age = Math.floor(Date.now() / 1000) - quote.publishTime;
      const fresh = age <= 120;
      console.log(
        `  ok    ${ticker} ${quote.price.toString()}  ${Math.round(age / 60)}m old  ` +
          `${fresh ? "fresh" : "stale, the program will refuse it"}`,
      );
    } catch (err) {
      check(`${ticker} quote`, false, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("\n=== 7. crypto: mids and the next hourly slots ===");
  try {
    const mids = await allMids();
    const nowSec = Math.floor(Date.now() / 1000);
    for (const asset of CRYPTO_ASSETS) {
      const quote = midToQuote(mids[coinOf(asset.symbol)], nowSec, coinOf(asset.symbol));
      console.log(`  ok    ${asset.symbol} ${quote.price.toString()}  read just now`);
    }
  } catch (err) {
    check("hyperliquid mids", false, err instanceof Error ? err.message : String(err));
  }
  for (const asset of CRYPTO_ASSETS) {
    if (!asset.hourly) continue;
    for (const slot of hourlySlotsAhead(nowSecFor(new Date()))) {
      const market = marketPda(program.programId, asset.symbol, slot.sessionId, "fair");
      const exists = await program.provider.connection.getAccountInfo(market);
      console.log(`        ${asset.symbol} ${slot.sessionId}  ${exists ? "already created" : "not yet"}  ${market.toBase58()}`);
    }
  }

  console.log(
    failures === 0
      ? "\nAll checks passed. Stale quotes outside market hours are expected.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("\npreflight failed:", err?.message ?? err);
  process.exit(1);
});
