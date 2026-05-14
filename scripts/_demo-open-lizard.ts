// One-shot demo: insert a fake open paper-position for Liquidation Lizard
// so the feed UI shows the active state without waiting for a real HL
// liquidation event. Run with: npx tsx --env-file=.env.local scripts/_demo-open-lizard.ts
import { db } from "@/lib/db";
import { paperPositions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  // First close any existing open position so we don't pile up
  await db
    .update(paperPositions)
    .set({ status: "expired", exitTs: new Date() })
    .where(
      and(
        eq(paperPositions.botId, "liquidation-lizard"),
        eq(paperPositions.status, "open"),
      ),
    );

  // Pull current SOL mark via HL
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  const data = (await res.json()) as Record<string, string>;
  const currentMark = Number(data.SOL);
  // Pretend we entered 0.5% below — gives +25% live PnL at 50x
  const entryMark = currentMark * 0.995;

  const [row] = await db
    .insert(paperPositions)
    .values({
      botId: "liquidation-lizard",
      asset: "SOL",
      side: "long",
      leverage: 50,
      entryMark,
      triggerMeta: { demo: true, currentMarkAtInsert: currentMark },
      status: "open",
    })
    .returning();

  console.log("opened demo paper position:");
  console.log(`  id: ${row.id}`);
  console.log(`  entry: ${entryMark.toFixed(4)}`);
  console.log(`  current: ${currentMark.toFixed(4)}`);
  console.log(`  expected live PnL: +${((currentMark - entryMark) / entryMark * 50 * 100).toFixed(1)}%`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
