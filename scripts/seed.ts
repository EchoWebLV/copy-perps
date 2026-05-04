import { db } from "../lib/db";
import { signals } from "../lib/db/schema";
import { mockSignals } from "../lib/mock-data";

async function main() {
  console.log(`Seeding ${mockSignals.length} signals…`);

  await db.delete(signals);

  for (const s of mockSignals) {
    const assetId =
      s.type === "meme"
        ? s.ticker
        : s.type === "prediction"
          ? s.id
          : s.walletAddress;

    await db.insert(signals).values({
      id: s.id,
      type: s.type,
      assetId,
      heatScore: s.heatScore,
      payload: s,
      createdAt: new Date(s.createdAt),
    });
    console.log(`  · ${s.id} (${s.type}, heat ${s.heatScore})`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
