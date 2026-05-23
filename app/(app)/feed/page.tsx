import { BotRoster } from "@/components/feed/BotRoster";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleRoster } from "@/components/whales/WhaleRoster";
import { whaleSocialEnabled } from "@/lib/features";
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /feed is now the alpha-arena ROSTER - a birdeye view of every paper
// bot. The TikTok-style per-position feed lives on /live, opened
// via the elevated ⚡ button in the bottom nav.
export default async function FeedPage() {
  if (whaleSocialEnabled()) {
    const whales = await buildWhaleTraderSignals();

    return (
      <>
        <WhaleRoster initialWhales={whales} />
        <BottomNav />
      </>
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
