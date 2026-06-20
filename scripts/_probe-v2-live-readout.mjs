// READ-ONLY live readout: polls the user's Flash v2 owner snapshot until a
// position appears, then prints the venue's real numbers + a close-position
// quote (proceeds if closed now). The close quote BUILDS a tx but is never
// signed or submitted, so nothing moves. Run in background:
//   node --env-file=.env.local scripts/_probe-v2-live-readout.mjs
const REST = process.env.FLASH_V2_REST_BASE ?? "https://flashapi.trade/v2";
const OWNER = process.env.PROBE_OWNER ?? "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap() {
  try {
    return await (await fetch(`${REST}/owner/${OWNER}`)).json();
  } catch (e) {
    return { error: String(e) };
  }
}
async function solOracle() {
  try {
    const p = await (await fetch(`${REST}/prices`)).json();
    return Number(p?.SOL?.priceUi);
  } catch {
    return null;
  }
}

console.log(`Polling ${REST}/owner/${OWNER} for a live position...`);
let pm = {};
for (let i = 0; i < 80; i++) {
  const s = await snap();
  pm = s?.positionMetrics ?? {};
  if (Object.keys(pm).length) break;
  if (i % 5 === 0) console.log(`  ...waiting (${i * 3}s)`);
  await sleep(3000);
}
if (!Object.keys(pm).length) {
  console.log("No position appeared within ~4 min. Re-run after opening.");
  process.exit(0);
}

const oracle = await solOracle();
console.log(`\n=== LIVE positionMetrics (SOL oracle = ${oracle}) ===`);
console.log(JSON.stringify(pm, null, 2));

for (const [key, m] of Object.entries(pm)) {
  const num = (v) => (v == null ? null : Number(v));
  const size = num(m.sizeUsdUi ?? m.sizeUsd);
  const collat = num(m.collateralUsdUi ?? m.collateralUsd);
  const lev = num(m.leverageUi ?? m.leverage);
  const entry = num(m.entryPriceUi ?? m.entryPrice);
  const side = String(m.sideUi ?? m.side ?? "").toUpperCase().startsWith("S") ? "SHORT" : "LONG";
  const sym = m.symbol ?? m.marketSymbol ?? key;
  const stakeFromSize = lev ? size / lev : null;

  console.log(`\n--- ${sym} ${side} ---`);
  console.log(`  venue collateralUsd : ${collat}`);
  console.log(`  venue sizeUsd       : ${size}`);
  console.log(`  venue leverage      : ${lev}`);
  console.log(`  entryPrice          : ${entry}  (oracle ${oracle}, ${oracle && entry ? (((entry - oracle) / oracle) * 100).toFixed(3) + "%" : "?"})`);
  console.log(`  UI stake = size/lev : ${stakeFromSize?.toFixed(4)}   <-- what the card shows`);
  console.log(`  collateral (real $) : ${collat?.toFixed(4)}          <-- what you actually hold`);

  // Close-position quote: how much USDC you'd receive closing the full size now.
  try {
    const body = {
      owner: OWNER,
      marketSymbol: String(sym),
      side,
      inputUsdUi: String(size),
      withdrawTokenSymbol: "USDC",
    };
    const r = await fetch(`${REST}/transaction-builder/close-position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch { j = txt; }
    if (j && typeof j === "object") {
      const { transaction, transactionBase64, ...rest } = j;
      console.log(`  CLOSE quote (HTTP ${r.status}):`, JSON.stringify(rest));
    } else {
      console.log(`  CLOSE quote (HTTP ${r.status}):`, String(j).slice(0, 160));
    }
  } catch (e) {
    console.log("  close quote error:", String(e));
  }
}
