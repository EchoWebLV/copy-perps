import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleLiveFeed } from "@/components/whales/WhaleLiveFeed";
import { WhaleMarketHeatmap } from "@/components/whales/WhaleMarketHeatmap";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /live is the market-level whale money heatmap. The old per-position
// swipe feed remains hidden behind ?mode=swipe so it can be compared
// without putting it back in the main nav.
export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
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
