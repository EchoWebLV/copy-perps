import { db } from "@/lib/db";
import { bots } from "@/lib/db/schema";

async function main() {
  await db
    .insert(bots)
    .values({
      id: "liquidation-lizard",
      parentId: null,
      name: "Liquidation Lizard",
      avatarEmoji: "🦎",
      personaVoiceKey: "liquidation-lizard",
      strategyKey: "liquidation-lizard",
      config: {
        minLiqNotionalUsd: 50_000,
        leverage: 50,
        exitFavorablePct: 0.005,
        maxHoldMs: 90_000,
      },
      status: "paper",
    })
    .onConflictDoNothing();
  console.log("seeded liquidation-lizard");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
