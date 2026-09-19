// =============================================================================
// What is actually on chain
// =============================================================================
//
// Reads every Market account and prints the daily ladders and intraday
// sessions, flagging any ladder that is missing a rung. Written when TSLA
// shipped one rung of three for 2026-09-22 and the board gave no hint why:
// a market that was never created looks exactly like one that never existed.
//
//   npx tsx scripts/list-markets.ts
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=... npx tsx scripts/list-markets.ts

import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, utils } from "@coral-xyz/anchor";

import idl from "../lib/lambdas/shared/idl/movex_equities.json";

const PROGRAM = new PublicKey("9j2X63EpuSxBSqfMKNrcbQUFzzrXiU8ok2PbUYucZ8zL");
const url = process.env.RPC_URL || "https://api.devnet.solana.com";

/** Underlying and session are fixed width, padded with spaces. */
const txt = (b: number[]) => Buffer.from(b).toString("utf8").replace(/[\0 ]+$/, "");

const et = (t: number) =>
  new Date(t * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const isDaily = (session: string) => /^\d{4}-\d{2}-\d{2}$/.test(session);

interface Row {
  sym: string;
  session: string;
  tier: string;
  pct: string;
  state: string;
  yes: number;
  no: number;
  lock: string;
  settle: string;
}

async function main() {
  const connection = new Connection(url, "confirmed");
  const coder = new BorshAccountsCoder(idl as never);
  const accounts = await connection.getProgramAccounts(PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(coder.accountDiscriminator("Market")) } },
    ],
  });

  const rows: Row[] = [];
  for (const a of accounts) {
    let decoded: unknown;
    try {
      decoded = coder.decode("Market", a.account.data);
    } catch {
      continue;
    }
    const m = decoded as Record<string, never>;
    rows.push({
      sym: txt(m["underlying"] as unknown as number[]),
      session: txt(m["session_date"] as unknown as number[]),
      tier: Object.keys(m["tier"])[0],
      pct: (Number(m["strike_bps"]) / 100).toFixed(2) + "%",
      state: Object.keys(m["state"])[0],
      yes: Math.round(Number(m["above_pool"]) / 1e6),
      no: Math.round(Number(m["below_pool"]) / 1e6),
      lock: et(Number(m["lock_ts"])),
      settle: et(Number(m["settle_ts"])),
    });
  }

  rows.sort(
    (x, y) =>
      x.session.localeCompare(y.session) ||
      x.sym.localeCompare(y.sym) ||
      parseFloat(x.pct) - parseFloat(y.pct),
  );

  console.log("now:", et(Math.floor(Date.now() / 1000)), "ET");
  console.log("markets on chain:", rows.length);

  const daily = rows.filter((r) => isDaily(r.session));
  console.log("\n=== daily, last 4 sessions ===");
  const sessions = [...new Set(daily.map((r) => r.session))].slice(-4);
  console.table(daily.filter((r) => sessions.includes(r.session)));

  // A daily ladder is three rungs. Anything less is a market that was never
  // created, which is invisible on the board.
  console.log("\n=== daily ladders missing a rung ===");
  const byLadder = new Map<string, string[]>();
  for (const r of daily) {
    const key = r.session + " " + r.sym;
    byLadder.set(key, [...(byLadder.get(key) ?? []), r.tier]);
  }
  const broken = [...byLadder.entries()]
    .filter(([, tiers]) => tiers.length < 3)
    .map(([ladder, tiers]) => ({ ladder, has: tiers.join(", ") }));
  console.table(broken.length ? broken : [{ ladder: "none", has: "every ladder complete" }]);

  console.log("\n=== intraday sessions ===");
  const hourly = rows.filter((r) => !isDaily(r.session));
  const byDay = new Map<string, number>();
  for (const r of hourly) {
    const day = r.session.split("-")[0];
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  console.table([...byDay.entries()].map(([day, slots]) => ({ day, slots })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
