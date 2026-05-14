// scripts/probe-chat.ts
// Exercises chatWithBot() with realistic position context, no DB needed.
import "dotenv/config";
import { chatWithBot } from "../lib/bots/chat";

async function main() {
  const reply = await chatWithBot({
    personaKey: "funding-phoebe",
    positions: [
      {
        asset: "SOL",
        side: "long",
        leverage: 20,
        entryMark: 93.36,
        currentMark: 93.24,
        stakePnlPct: -0.026,
        stakeUsd: 150,
      },
      {
        asset: "AVAX",
        side: "short",
        leverage: 20,
        entryMark: 10.04,
        currentMark: 10.08,
        stakePnlPct: -0.087,
        stakeUsd: 167,
      },
    ],
    history: [],
    userMessage: "why are you still in that AVAX short, it's bleeding?",
    bankrollUsd: 948,
  });
  console.log("Phoebe Q1 reply:\n", reply, "\n");

  const reply2 = await chatWithBot({
    personaKey: "liquidation-lizard",
    positions: [],
    history: [],
    userMessage: "what kind of setup are you waiting for right now?",
    bankrollUsd: 1000,
  });
  console.log("Lizard Q2 reply:\n", reply2);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
