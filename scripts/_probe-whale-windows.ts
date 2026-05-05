import { CURATED_WHALES } from "@/lib/hyperliquid/whales";
const ASSETS = new Set(["SOL","BTC","ETH"]);
const MIN_USD = 25_000, MIN_LEV = 1.5;

async function call<T>(t: string, b: Record<string, unknown>) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: t, ...b }),
  });
  if (!r.ok) throw new Error(`${t} ${r.status}`);
  return (await r.json()) as T;
}
function opens(d: string, side: "long"|"short") {
  if (side === "long") return d === "Open Long" || d === "Short > Long";
  return d === "Open Short" || d === "Long > Short";
}

async function main() {
  const now = Date.now();
  const states = new Map<string, any>();
  console.log("Fetching state for all 55 wallets (serial)...");
  for (const w of CURATED_WHALES) {
    try {
      states.set(w.address, await call<any>("clearinghouseState", { user: w.address }));
    } catch {}
    await new Promise((r) => setTimeout(r, 40));
  }

  const fills = new Map<string, any[]>();
  console.log("Fetching 14d fills (serial)...");
  for (const w of CURATED_WHALES) {
    try {
      fills.set(w.address, await call<any[]>("userFillsByTime", { user: w.address, startTime: now - 14*24*3600*1000 }));
    } catch {}
    await new Promise((r) => setTimeout(r, 40));
  }

  for (const days of [3, 7, 14]) {
    const cutoff = now - days*24*3600*1000;
    let count = 0;
    let positionsExamined = 0;
    let underSize = 0, underLev = 0;
    for (const w of CURATED_WHALES) {
      const s = states.get(w.address);
      const f = fills.get(w.address) ?? [];
      if (!s) continue;
      const positions = s.assetPositions.map((ap: any) => ap.position);
      for (const p of positions) {
        if (!ASSETS.has(p.coin.toUpperCase())) continue;
        positionsExamined++;
        if (parseFloat(p.positionValue) < MIN_USD) { underSize++; continue; }
        if ((p.leverage?.value ?? 0) < MIN_LEV) { underLev++; continue; }
        const sz = parseFloat(p.szi);
        const side: "long"|"short" = sz >= 0 ? "long" : "short";
        const candidates = f.filter((fl) => fl.coin === p.coin && opens(fl.dir, side) && fl.time >= cutoff);
        if (candidates.length === 0) continue;
        count++;
      }
    }
    console.log(`  ${days}d: ${count} signals  (SBE positions examined: ${positionsExamined}, underSize: ${underSize}, underLev: ${underLev})`);
  }

  // Also: count all currently-open SBE positions, no fill check
  let allOpen = 0;
  for (const w of CURATED_WHALES) {
    const s = states.get(w.address);
    if (!s) continue;
    for (const ap of s.assetPositions) {
      const p = ap.position;
      if (!ASSETS.has(p.coin.toUpperCase())) continue;
      if (parseFloat(p.positionValue) < MIN_USD) continue;
      if ((p.leverage?.value ?? 0) < MIN_LEV) continue;
      allOpen++;
    }
  }
  console.log(`  All currently-open SBE positions (no fill check): ${allOpen}`);

  // What if we lower size threshold?
  for (const minUsd of [10_000, 5_000]) {
    let cnt = 0;
    for (const w of CURATED_WHALES) {
      const s = states.get(w.address);
      if (!s) continue;
      for (const ap of s.assetPositions) {
        const p = ap.position;
        if (!ASSETS.has(p.coin.toUpperCase())) continue;
        if (parseFloat(p.positionValue) < minUsd) continue;
        if ((p.leverage?.value ?? 0) < MIN_LEV) continue;
        cnt++;
      }
    }
    console.log(`  Currently-open SBE positions at min $${minUsd/1000}k: ${cnt}`);
  }
}
main().catch(console.error);
