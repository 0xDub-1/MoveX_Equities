// What is actually fresh, and where?
//
// Two different kinds of staleness get conflated: how recent Pythnet's
// aggregate is (Hermes), and when someone last wrote it into a Solana
// account (on-chain). Posting updates ourselves fixes the second. It cannot
// fix the first, because a closed market produces no ticks.
import { readFileSync } from "node:fs";

const HERMES = "https://hermes.pyth.network";
const feeds = JSON.parse(
  readFileSync(new URL("./pyth-feeds.json", import.meta.url), "utf8"),
).feeds.filter((f: any) => f.ok);

const ids = feeds.map((f: any) => `ids[]=${f.feedId}`).join("&");
async function main() {
const res = await fetch(`${HERMES}/v2/updates/price/latest?${ids}`);
const body = (await res.json()) as any;

const now = Math.floor(Date.now() / 1000);
const fmt = (s: number) =>
  s < 120 ? `${s}s` : s < 86_400 ? `${Math.round(s / 60)}m` : `${(s / 86_400).toFixed(1)}d`;

console.log("symbol     hermes age   on-chain age   hermes price");
console.log("-".repeat(60));

for (const f of feeds) {
  const parsed = body.parsed.find((p: any) => p.id === f.feedId);
  if (!parsed) {
    console.log(`${f.symbol.padEnd(10)} not returned by hermes`);
    continue;
  }
  const price = Number(parsed.price.price) * 10 ** Number(parsed.price.expo);
  const hermesAge = now - Number(parsed.price.publish_time);
  console.log(
    `${f.symbol.padEnd(10)} ${fmt(hermesAge).padStart(10)}   ${fmt(f.ageSecs).padStart(12)}   ${price.toFixed(4)}`,
  );
}

console.log(
  "\nIf a crypto feed is seconds old on hermes but minutes old on chain,\n" +
    "posting our own updates fixes it. If an equity feed is days old on\n" +
    "hermes too, nothing fixes it until the market reopens, and that is the\n" +
    "correct behaviour rather than a problem to route around.",
);

}
main();
