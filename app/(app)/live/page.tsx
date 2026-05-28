import { LiveFeed } from "@/components/feed/LiveFeed";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleLiveFeed } from "@/components/whales/WhaleLiveFeed";
import { WhaleMarketHeatmap } from "@/components/whales/WhaleMarketHeatmap";
import { whaleSocialEnabled } from "@/lib/features";
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /live is the market-level whale money heatmap. The old per-position
// swipe feed remains hidden behind ?mode=swipe so it can be compared
// without putting it back in the main nav.
export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ bot?: string; mode?: string }>;
}) {
  if (whaleSocialEnabled()) {
    const [positions, params] = await Promise.all([
      buildWhalePositionSignals(1000),
      searchParams,
    ]);

    return (
      <AppShell railTitle="Whale Heat">
        {params.mode === "swipe" ? (
          <WhaleLiveFeed initialPositions={positions} />
        ) : (
          <WhaleMarketHeatmap initialPositions={positions} />
        )}
        <BottomNav />
      </AppShell>
    );
  }

  const [bots, params] = await Promise.all([
    buildBotSignals(),
    searchParams,
  ]);
  const sorted = [...bots].sort(
    (a, b) => b.payload.balanceUsd - a.payload.balanceUsd,
  );
  const botFilter = params.bot ?? null;

  return (
    <>
      <LiveFeed initialBots={sorted} botFilter={botFilter} />
      <BottomNav />
    </>
  );
}
