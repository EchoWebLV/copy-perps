import { BotRoster } from "@/components/feed/BotRoster";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleRoster } from "@/components/whales/WhaleRoster";
import { whaleSocialEnabled } from "@/lib/features";
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /feed is the primary whale list: source accounts, total P/L, open
// positions, and tail actions. The swipeable per-position view lives on /live.
export default async function FeedPage() {
  if (whaleSocialEnabled()) {
    const whales = await buildWhaleTraderSignals();

    return (
      <AppShell railTitle="Whales">
        <WhaleRoster initialWhales={whales} />
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
