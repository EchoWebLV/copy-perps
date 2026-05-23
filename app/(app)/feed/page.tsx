import { BotRoster } from "@/components/feed/BotRoster";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleLiveFeed } from "@/components/whales/WhaleLiveFeed";
import { whaleSocialEnabled } from "@/lib/features";
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /feed is the primary social surface: live whale source positions with
// tail actions and generated commentary.
export default async function FeedPage() {
  if (whaleSocialEnabled()) {
    const positions = await buildWhalePositionSignals();

    return (
      <AppShell railTitle="Live Positions">
        <WhaleLiveFeed initialPositions={positions} />
        <BottomNav />
      </AppShell>
    );
  }

  const bots = await buildBotSignals();
  // Highest equity first - that's the scoreboard order. Same sort as
  // /api/bots/roster so the initial paint matches the first poll.
  const sorted = [...bots].sort(
    (a, b) => b.payload.balanceUsd - a.payload.balanceUsd,
  );

  return (
    <>
      <BotRoster initialBots={sorted} />
      <BottomNav />
    </>
  );
}
