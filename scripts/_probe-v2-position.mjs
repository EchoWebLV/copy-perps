// READ-ONLY: dump the user's live Flash v2 owner snapshot (positions + collateral)
// and compare the open-quote entry price against the oracle mark to measure the
// entry spread. No writes. Run: node --env-file=.env.local scripts/_probe-v2-position.mjs
const REST = process.env.FLASH_V2_REST_BASE ?? "https://flashapi.trade/v2";
const OWNER = process.env.PROBE_OWNER ?? "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";

const ownerRes = await fetch(`${REST}/owner/${OWNER}`);
const snap = await ownerRes.json().catch(() => null);

console.log("=== owner snapshot top-level keys ===");
console.log(snap && typeof snap === "object" ? Object.keys(snap) : snap);

const pm = snap?.positionMetrics ?? snap?.positions ?? null;
console.log("\n=== positionMetrics (live positions) ===");
console.log(JSON.stringify(pm, null, 2)?.slice(0, 2500));

// oracle marks
const prices = await (await fetch(`${REST}/prices`)).json().catch(() => ({}));
const sol = prices?.SOL;
console.log("\n=== SOL oracle ===", JSON.stringify(sol));

// fresh open quote at a few sizes — capture entry vs oracle (spread) + youReceive
async function quote(c, l, side = "LONG") {
  const r = await fetch(`${REST}/transaction-builder/open-position`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner: OWNER,
      inputTokenSymbol: "USDC",
      outputTokenSymbol: "SOL",
      inputAmountUi: String(c),
      leverage: l,
      tradeType: side,
      orderType: "MARKET",
    }),
  });
  const j = await r.json().catch(() => null);
  return j;
}

const solOracle = sol?.priceUi ?? null;
console.log(`\n=== entry spread vs oracle (SOL oracle = ${solOracle}) ===`);
console.log("collat  lev  side   entry      oracle    spread%   youRecv   impliedNotional  immExitLoss");
for (const [c, l, side] of [[1, 20, "LONG"], [1, 20, "SHORT"], [10, 20, "LONG"], [50, 20, "LONG"], [1, 5, "LONG"]]) {
  const j = await quote(c, l, side);
  if (!j || j.err) {
    console.log(`$${c} ${l}x ${side}: ${JSON.stringify(j)?.slice(0, 80)}`);
    continue;
  }
  const entry = Number(j.newEntryPrice);
  const recv = Number(j.youRecieveUsdUi);
  const spreadPct = solOracle ? ((entry - solOracle) / solOracle) * 100 : NaN;
  // immediate exit loss if mark = oracle: notional * spread fraction
  const immLoss = solOracle ? (recv * (entry - solOracle)) / solOracle : NaN;
  console.log(
    `$${c}\t${l}x\t${side}\t${entry}\t${solOracle}\t${spreadPct.toFixed(3)}%\t${recv}\t${(c * l).toFixed(0)}\t$${immLoss.toFixed(4)}`,
  );
}
