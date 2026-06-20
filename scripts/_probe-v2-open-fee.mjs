// READ-ONLY probe of the Flash v2 open-position fee composition.
// Calls /transaction-builder/open-position to BUILD quotes (it returns an
// unsigned tx + a fee/price quote). Nothing is ever signed or submitted, so no
// funds move and no position is opened. Run:
//   node --env-file=.env.local scripts/_probe-v2-open-fee.mjs
const REST = process.env.FLASH_V2_REST_BASE ?? "https://flashapi.trade/v2";
const OWNER = process.env.PROBE_OWNER ?? "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";

async function openQuote({ symbol, collateralUsd, leverage, side = "LONG" }) {
  const body = {
    owner: OWNER,
    inputTokenSymbol: "USDC",
    outputTokenSymbol: symbol,
    inputAmountUi: String(collateralUsd),
    leverage,
    tradeType: side,
    orderType: "MARKET",
  };
  const res = await fetch(`${REST}/transaction-builder/open-position`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function getPrices() {
  for (const path of ["/prices", `/owner/${OWNER}`]) {
    try {
      const r = await fetch(`${REST}${path}`);
      const j = await r.json();
      if (j) return { path, j };
    } catch {
      /* ignore */
    }
  }
  return null;
}

console.log("REST:", REST);
console.log("OWNER:", OWNER);

// 1) FULL raw dump for the canonical $1 @ 20x SOL LONG (minus the giant base64 tx)
const canonical = await openQuote({ symbol: "SOL", collateralUsd: 1, leverage: 20 });
console.log(`\n=== $1 @ 20x SOL LONG — FULL RAW (HTTP ${canonical.status}) ===`);
if (canonical.json && typeof canonical.json === "object") {
  const { transaction, transactionBase64, ...rest } = canonical.json;
  console.log(JSON.stringify(rest, null, 2));
  console.log("has tx field:", !!(transaction || transactionBase64));
} else {
  console.log(String(canonical.json).slice(0, 400));
}

// 2) Scaling: does entryFee track notional, collateral, or have a fixed floor?
const probes = [
  { c: 1, l: 10 }, { c: 1, l: 20 }, { c: 1, l: 50 }, // fixed collat → notional 10/20/50
  { c: 5, l: 20 }, { c: 10, l: 20 }, { c: 50, l: 20 }, // fixed lev → notional 100/200/1000
  { c: 10, l: 2 }, { c: 2, l: 10 }, { c: 20, l: 1 }, // notional 20 via different combos
];
console.log("\n=== entryFee scaling (SOL LONG) ===");
console.log("collat   lev   notional   entryFee    youPay    youRecv   fee/notional   fee/collat");
for (const { c, l } of probes) {
  const q = await openQuote({ symbol: "SOL", collateralUsd: c, leverage: l });
  if (q.status !== 200 || typeof q.json !== "object") {
    console.log(`$${c}\t${l}x\tHTTP ${q.status}: ${String(q.json?.err ?? q.json).slice(0, 70)}`);
    continue;
  }
  const fee = Number(q.json.entryFee);
  const notional = c * l;
  const bps = notional > 0 ? (fee / notional) * 10000 : 0;
  const pctCollat = c > 0 ? (fee / c) * 100 : 0;
  console.log(
    `$${c}\t${l}x\t$${notional}\t$${Number.isFinite(fee) ? fee.toFixed(5) : fee}\t` +
      `${q.json.youPayUsdUi ?? "-"}\t${q.json.youRecieveUsdUi ?? "-"}\t` +
      `${bps.toFixed(2)} bps\t${pctCollat.toFixed(2)}%`,
  );
}

// 3) entry price vs oracle mark (spread / price-impact on a LONG)
const px = await getPrices();
console.log(`\n=== price reference (${px?.path ?? "none"}) ===`);
if (px?.j) console.log(JSON.stringify(px.j).slice(0, 600));
