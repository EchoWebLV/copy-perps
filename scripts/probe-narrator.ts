// scripts/probe-narrator.mjs
// Hits narrateOpenSafe / narrateCloseSafe with realistic args to confirm
// the xAI wire-up returns prose (or null + a warn on failure).
import "dotenv/config";
import { narrateOpenSafe, narrateCloseSafe } from "../lib/bots/narrator";

async function main() {
  const openResult = await narrateOpenSafe({
    personaKey: "funding-phoebe",
    asset: "SOL",
    side: "long",
    leverage: 3,
    entryMark: 142.5,
    trigger: {
      avgRate: -0.000089,
      venuesAgreed: 3,
      venuesQueried: 4,
      perVenue: { okx: -0.0001, binance: -0.00005, bybit: -0.00019, dydx: 0.000016 },
    },
  });
  console.log("narrateOpenSafe →", openResult);

  const closeResult = await narrateCloseSafe({
    personaKey: "liquidation-lizard",
    asset: "BTC",
    side: "short",
    entryMark: 67500,
    exitMark: 66100,
    paperPnlUsd: 31.4,
  });
  console.log("narrateCloseSafe →", closeResult);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
