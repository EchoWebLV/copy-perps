// scripts/_probe-hl-liquidations.mjs
// Probe several HL REST /info types to discover the liquidation data shape.
//
// FINDINGS (2026-05-14):
// - "recentTrades" (requires coin param) returns: coin, side, px, sz, time,
//   hash, tid, users[2] — NO liquidation field.
// - "liquidations", "allLiquidations", "recentLiquidations" all 422.
// - Zero-hash trades in recentTrades are NOT a reliable liquidation indicator
//   (HL docs: zero-hash means HL internal matching, not liquidations specifically).
// - The "liquidation" sub-object ONLY appears in the WebSocket "trades" channel:
//   { coin, side, px, sz, time, hash, tid, liquidation: { liquidatedUser, markPx, method } }
// - REST does NOT expose a global liquidation stream.
// - Per-user fills via "userFillsByTime" DO use dir="Liquidated Long"/"Liquidated Short"
//   but only for the liquidated user — you'd have to poll every curated whale wallet.
// - getRecentLiquidations() in lib/hyperliquid/client.ts uses userFillsByTime against
//   the CURATED_WHALES list to pick up their liquidation fills, which is the only
//   REST-accessible liquidation signal. Phase 2 should upgrade to WS subscription.

const TYPES = ["recentTrades", "liquidations", "userFills"];
for (const type of TYPES) {
  console.log(`\n--- ${type} ---`);
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (!res.ok) {
      console.log(`status: ${res.status} (requires additional params or unsupported type)`);
      continue;
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      console.log(`array length: ${data.length}`);
      if (data.length > 0) console.log("first:", JSON.stringify(data[0], null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2).slice(0, 500));
    }
  } catch (err) {
    console.log("error:", String(err));
  }
}

// recentTrades with required coin param — shows the actual REST trade shape
console.log("\n--- recentTrades (coin: BTC) ---");
try {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "recentTrades", coin: "BTC" }),
  });
  const data = await res.json();
  console.log(`count: ${data.length}`);
  console.log("fields:", Object.keys(data[0]));
  console.log("has 'liquidation' field:", data.some((r) => "liquidation" in r));
  console.log("first record:", JSON.stringify(data[0], null, 2));
} catch (err) {
  console.log("error:", String(err));
}

// userFillsByTime — the only REST path that exposes 'Liquidated Long/Short' dir
console.log("\n--- userFillsByTime sample (public active trader, last 5min) ---");
try {
  const startTime = Date.now() - 5 * 60 * 1000;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "userFillsByTime",
      user: "0xe3b3482482899b4890ec5a2093cba2a558d0c14f",
      startTime,
    }),
  });
  const data = await res.json();
  console.log(`fills: ${data.length}`);
  if (data.length > 0) {
    console.log("fields:", Object.keys(data[0]));
    const dirs = [...new Set(data.map((f) => f.dir))];
    console.log("unique dirs:", dirs);
    const liqFills = data.filter(
      (f) => f.dir && f.dir.toLowerCase().includes("liquidat"),
    );
    console.log("liquidation fills:", liqFills.length);
    if (liqFills.length > 0) {
      console.log("example:", JSON.stringify(liqFills[0], null, 2));
    }
  }
} catch (err) {
  console.log("error:", String(err));
}
