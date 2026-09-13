// =============================================================================
// Resolve and verify Pyth price feed accounts on devnet
// =============================================================================
//
// Addresses are derived, not copied from a table, then checked against the
// chain. Seeding a market against an address nobody verified means `lock`
// fails at 16:00 and the market voids six hours later with nobody able to say
// why.
//
// The check is self-validating: the feed id read out of the on-chain account
// must equal the one Hermes gave for the symbol. A wrong receiver program id
// or a wrong seed layout produces an address that either holds nothing or
// holds a different feed, and both show up immediately.
//
//   npx tsx pyth-feeds.ts
//
// Output doubles as a liveness report. Equity feeds stop publishing when the
// US market closes, so out of hours the age column is the interesting one.
//
// Decoding is done by hand rather than through @pythnetwork/pyth-solana-
// receiver: that package pulls an rpc-websockets major that breaks
// @solana/web3.js, and the layout below is short enough not to be worth the
// dependency conflict.

import { Connection, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const HERMES = "https://hermes.pyth.network";

/**
 * Sponsored price feed accounts live under the push oracle program, not the
 * receiver. The receiver owns the ephemeral per-update accounts, of which
 * devnet holds several hundred thousand: deriving against it produced five
 * addresses with nothing at them, which is how this was found.
 *
 * The accounts themselves are still PriceUpdateV2, so the decoder is shared.
 */
const PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

/**
 * Who owns the resulting account. Two different programs, and conflating
 * them is what made the first two attempts fail: the address is derived
 * under the push oracle, but the account it creates is owned by the
 * receiver, which is the program that writes price updates into it.
 */
const RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/** Shard 0 is the set the Pyth Data Association sponsors on both clusters. */
const SHARD = 0;

/** Matches the program's own MAX_PRICE_AGE_SECS. */
const MAX_AGE = 120;

const WANTED = [
  { symbol: "NVDA", query: "NVDA", assetType: "equity" },
  { symbol: "TSLA", query: "TSLA", assetType: "equity" },
  { symbol: "SPY", query: "SPY", assetType: "equity" },
  // 24/7, so there is always a live feed to demo against out of hours.
  { symbol: "BTC/USD", query: "BTC/USD", assetType: "crypto" },
  { symbol: "SOL/USD", query: "SOL/USD", assetType: "crypto" },
];

/** `[shard as u16 LE, feed_id]` under the receiver program. */
function priceFeedAccount(shard: number, feedIdHex: string): PublicKey {
  const shardBytes = Buffer.alloc(2);
  shardBytes.writeUInt16LE(shard, 0);
  const feedId = Buffer.from(feedIdHex.replace(/^0x/, ""), "hex");
  if (feedId.length !== 32) throw new Error(`feed id must be 32 bytes, got ${feedId.length}`);
  return PublicKey.findProgramAddressSync([shardBytes, feedId], PUSH_ORACLE)[0];
}

interface PriceMessage {
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
}

/**
 * PriceUpdateV2, laid out by borsh:
 *
 *   8   discriminator
 *   32  write_authority
 *   1   verification_level variant, +1 byte when Partial carries a count
 *   32  price_message.feed_id
 *   8   price          i64
 *   8   conf           u64
 *   4   exponent       i32
 *   8   publish_time   i64
 *   ... prev_publish_time, ema_price, ema_conf, posted_slot
 */
function decodePriceUpdate(data: Buffer): PriceMessage {
  let o = 8 + 32;

  const variant = data.readUInt8(o);
  o += 1;
  if (variant === 0) o += 1; // Partial { num_signatures: u8 }
  else if (variant !== 1) throw new Error(`unknown verification level ${variant}`);

  const feedId = data.subarray(o, o + 32).toString("hex");
  o += 32;
  const price = data.readBigInt64LE(o);
  o += 8;
  const conf = data.readBigUInt64LE(o);
  o += 8;
  const exponent = data.readInt32LE(o);
  o += 4;
  const publishTime = data.readBigInt64LE(o);

  return { feedId, price, conf, exponent, publishTime };
}

async function hermesFeedId(query: string, assetType: string) {
  const url = `${HERMES}/v2/price_feeds?query=${encodeURIComponent(query)}&asset_type=${assetType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hermes ${res.status} for ${query}`);
  const feeds = (await res.json()) as any[];

  const base = query.split("/")[0].toUpperCase();
  const exact = feeds.find((f) => (f.attributes?.base ?? "").toUpperCase() === base);
  const chosen = exact ?? feeds[0];
  return chosen ? { id: chosen.id as string, symbol: chosen.attributes?.symbol as string } : null;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  const results: any[] = [];

  for (const want of WANTED) {
    const hermes = await hermesFeedId(want.query, want.assetType);
    if (!hermes) {
      results.push({ symbol: want.symbol, ok: false, note: "no feed id from hermes" });
      continue;
    }

    const address = priceFeedAccount(SHARD, hermes.id);
    const info = await connection.getAccountInfo(address);

    if (!info) {
      results.push({
        symbol: want.symbol,
        feedId: hermes.id,
        address: address.toBase58(),
        ok: false,
        note: "no account at the derived address on this cluster",
      });
      continue;
    }

    if (!info.owner.equals(RECEIVER)) {
      results.push({
        symbol: want.symbol,
        feedId: hermes.id,
        address: address.toBase58(),
        ok: false,
        note: `owned by ${info.owner.toBase58()}, not the receiver`,
      });
      continue;
    }

    const msg = decodePriceUpdate(info.data);
    const matches = msg.feedId === hermes.id;
    const price = Number(msg.price) * 10 ** msg.exponent;
    const conf = Number(msg.conf) * 10 ** msg.exponent;
    const age = now - Number(msg.publishTime);

    results.push({
      symbol: want.symbol,
      pythSymbol: hermes.symbol,
      feedId: hermes.id,
      address: address.toBase58(),
      ok: matches,
      price,
      confPct: price !== 0 ? (conf / price) * 100 : 0,
      publishTime: Number(msg.publishTime),
      ageSecs: age,
      live: age <= MAX_AGE,
      note: matches ? undefined : `on-chain feed id ${msg.feedId} does not match`,
    });
  }

  console.log(`cluster  ${RPC}`);
  console.log(`receiver ${RECEIVER.toBase58()}  shard ${SHARD}\n`);
  console.log("symbol     price           conf%     age        live   address");
  console.log("-".repeat(100));

  const fmtAge = (s: number) =>
    s < 120 ? `${s}s` : s < 86_400 ? `${Math.round(s / 60)}m` : `${(s / 86_400).toFixed(1)}d`;

  for (const r of results) {
    if (!r.ok && r.price === undefined) {
      console.log(`${r.symbol.padEnd(10)} ${(r.note ?? "failed").padEnd(52)} ${r.address ?? ""}`);
      continue;
    }
    console.log(
      `${r.symbol.padEnd(10)} ${r.price.toFixed(4).padStart(13)}  ${r.confPct.toFixed(3).padStart(7)}  ${fmtAge(r.ageSecs).padStart(8)}  ${(r.live ? "yes" : "NO").padEnd(5)}  ${r.address}`,
    );
    if (r.note) console.log(`           WARNING: ${r.note}`);
  }

  const out = new URL("./pyth-feeds.json", import.meta.url);
  writeFileSync(
    out,
    JSON.stringify({ cluster: RPC, receiver: RECEIVER.toBase58(), shard: SHARD, feeds: results }, null, 2),
  );
  console.log(`\nwrote ${out.pathname}`);

  const verified = results.filter((r) => r.ok).length;
  console.log(`\n${verified}/${results.length} feeds derived, found on chain, and feed-id matched.`);

  const stale = results.filter((r) => r.ok && !r.live);
  if (stale.length) {
    console.log(
      `\n${stale.map((s: any) => s.symbol).join(", ")} sit outside the program's ${MAX_AGE}s\n` +
        `window. Expected for equities out of US market hours: lock and settle\n` +
        `will refuse them rather than settle against a price from Friday.`,
    );
  }
}

main().catch((err) => {
  console.error("\nfailed:", err);
  process.exit(1);
});
