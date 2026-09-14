// What does Yahoo actually return for interval=1h?
//
// The hourly ladder comes out ten times too small and filtering extended
// hours barely helped, so this prints the raw bars rather than reasoning
// about them further.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

async function main() {
  for (const [range, interval] of [
    ["1mo", "1h"],
    ["5d", "1h"],
    ["5d", "60m"],
  ]) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    const body = (await res.json()) as any;
    const r = body?.chart?.result?.[0];

    console.log(`\n${"=".repeat(70)}`);
    console.log(`range=${range} interval=${interval}  status ${res.status}`);
    if (!r) {
      console.log("  no result:", JSON.stringify(body).slice(0, 200));
      continue;
    }

    const ts: number[] = r.timestamp ?? [];
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    console.log(`  bars: ${ts.length}`);
    console.log(`  meta.dataGranularity: ${r.meta?.dataGranularity}`);
    console.log(`  meta.range: ${r.meta?.range}`);
    console.log(
      `  tradingPeriod regular: ${JSON.stringify(r.meta?.currentTradingPeriod?.regular ?? null)}`,
    );

    // The last two days, with the move each bar implies.
    console.log("\n  last 16 bars (ET):");
    let prev: number | null = null;
    for (let i = Math.max(0, ts.length - 16); i < ts.length; i++) {
      const c = closes[i];
      const label = ET.format(new Date(ts[i] * 1000));
      if (c == null) {
        console.log(`    ${label}   null`);
        continue;
      }
      const move =
        prev == null ? "" : `${((Math.abs(c - prev) / prev) * 100).toFixed(3)}%`;
      console.log(`    ${label}   ${c.toFixed(4).padStart(10)}   ${move}`);
      prev = c;
    }

    // Gaps between consecutive timestamps tell us the real granularity,
    // regardless of what the interval parameter claimed.
    const deltas = new Map<number, number>();
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      deltas.set(d, (deltas.get(d) ?? 0) + 1);
    }
    const top = [...deltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    console.log(
      `\n  spacing between bars: ${top
        .map(([d, n]) => `${d}s x${n}`)
        .join(", ")}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
