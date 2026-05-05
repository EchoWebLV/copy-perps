import { listEvents } from "@/lib/jupiter-prediction/client";

async function main() {
  console.log("Fetching events at various limits to find the API ceiling...");

  for (const limit of [100, 200, 300, 500, 1000]) {
    try {
      const events = await listEvents({ limit });
      const active = events.filter((e) => e.isActive);
      const now = Date.now() / 1000;
      const openMarkets = active.flatMap((e) =>
        e.markets.filter((m) => m.status === "open" && m.closeTime > now),
      );
      console.log(
        `  limit=${limit}: ${events.length} events, ${active.length} active, ${openMarkets.length} open future markets`,
      );
      // If we asked for X but got less than X, we hit the cap
      if (events.length < limit) {
        console.log(
          `  → API caps at ${events.length}; asking higher won't help`,
        );
        break;
      }
    } catch (e) {
      console.log(`  limit=${limit}: ERROR ${String(e).slice(0, 100)}`);
    }
  }

  console.log("\n--- Filter funnel @ limit=300 (production setting) ---");
  const events = await listEvents({ limit: 300 });
  const now = Date.now();

  let active = 0;
  let withOpenMarket = 0;
  const dropDays: { count: number; days: number }[] = [];
  let dropMaxDays = 0;
  const volBuckets = { lt1k: 0, lt3k: 0, lt10k: 0, lt50k: 0, ge50k: 0 };
  let pricedOut = 0;
  let candidates = 0;

  for (const ev of events) {
    if (!ev.isActive) continue;
    active++;
    const open = ev.markets.filter(
      (m) => m.status === "open" && m.closeTime > now / 1000,
    );
    if (open.length === 0) continue;
    withOpenMarket++;

    const days = open
      .map((m) => (m.closeTime * 1000 - now) / (24 * 3600 * 1000))
      .reduce((min, v) => Math.min(min, v), Infinity);
    if (days > 365) {
      dropMaxDays++;
      dropDays.push({ count: 1, days });
      continue;
    }

    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < 1_000) volBuckets.lt1k++;
    else if (vol24 < 3_000) volBuckets.lt3k++;
    else if (vol24 < 10_000) volBuckets.lt10k++;
    else if (vol24 < 50_000) volBuckets.lt50k++;
    else volBuckets.ge50k++;

    if (vol24 < 3_000) continue;

    if (open.length === 1) {
      const yes = parseFloat(open[0].outcomePrices?.[0] ?? "0");
      if (!Number.isFinite(yes) || yes >= 0.99 || yes <= 0.005) {
        pricedOut++;
        continue;
      }
    }
    candidates++;
  }

  console.log(`  events fetched: ${events.length}`);
  console.log(`  isActive: ${active}`);
  console.log(`  has open future market: ${withOpenMarket}`);
  console.log(`  drop > 365d to resolve: ${dropMaxDays}`);
  console.log(`  volume24h buckets:`);
  console.log(`    < $1k:  ${volBuckets.lt1k}`);
  console.log(`    < $3k:  ${volBuckets.lt3k}  (current floor)`);
  console.log(`    < $10k: ${volBuckets.lt10k}`);
  console.log(`    < $50k: ${volBuckets.lt50k}`);
  console.log(`    >= $50k: ${volBuckets.ge50k}`);
  console.log(`  drop priced-out (>=99% or <=0.5%): ${pricedOut}`);
  console.log(`  ✓ qualifying candidates: ${candidates}`);

  console.log(`\n--- New split-into-binaries algorithm @ MAX_PER_EVENT=8 ---`);
  let totalSplit = 0;
  for (const ev of events) {
    if (!ev.isActive) continue;
    const open = ev.markets.filter(
      (m) => m.status === "open" && m.closeTime > now / 1000,
    );
    if (open.length === 0) continue;
    const days = open
      .map((m) => (m.closeTime * 1000 - now) / (24 * 3600 * 1000))
      .reduce((min, v) => Math.min(min, v), Infinity);
    if (days > 1000) continue;
    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < 3_000) continue;
    const valid = open
      .filter((m) => {
        const yes = parseFloat(m.outcomePrices?.[0] ?? "0");
        return Number.isFinite(yes) && yes > 0.005 && yes < 0.99;
      })
      .slice(0, 12);
    console.log(
      `  ${ev.metadata.title.slice(0, 50).padEnd(50)} → ${valid.length} markets`,
    );
    totalSplit += valid.length;
  }
  console.log(`  TOTAL split candidates: ${totalSplit}`);
}
main().catch(console.error);
