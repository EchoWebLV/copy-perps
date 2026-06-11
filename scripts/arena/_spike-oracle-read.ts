// scripts/arena/_spike-oracle-read.ts
// Spike B (GATE): reads MagicBlock's pushed Pyth Lazer SOLUSD feed PDA from the
// devnet Ephemeral Rollup and asserts the documented PriceUpdateV2 offsets parse
// to a sane, fresh price. Run: npx tsx scripts/arena/_spike-oracle-read.ts
import { Connection, PublicKey } from "@solana/web3.js";

const ER_ENDPOINT = "https://devnet.magicblock.app";
const SOLUSD_FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const PRICE_OFFSET = 73; // i64 LE
const PUBLISH_TS_OFFSET = 93; // i64 LE

async function main() {
  const conn = new Connection(ER_ENDPOINT, "processed");
  const info = await conn.getAccountInfo(SOLUSD_FEED);
  if (!info) throw new Error("feed account not found on ER endpoint");
  const price = info.data.readBigInt64LE(PRICE_OFFSET);
  const publishTs = info.data.readBigInt64LE(PUBLISH_TS_OFFSET);
  const ageSec = Math.floor(Date.now() / 1000) - Number(publishTs);
  const priceUsd = Number(price) / 1e8;
  console.log({
    owner: info.owner.toBase58(),
    dataLen: info.data.length,
    priceUsd,
    publishTs: Number(publishTs),
    ageSec,
  });
  if (priceUsd < 5 || priceUsd > 5000) throw new Error(`implausible SOL price ${priceUsd}`);
  if (ageSec > 60) throw new Error(`stale feed: ${ageSec}s old`);
  console.log("SPIKE B PASS");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
