import { LiveFeed } from "@/components/feed/LiveFeed";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleLiveFeed } from "@/components/whales/WhaleLiveFeed";
import { whaleSocialEnabled } from "@/lib/features";
import { buildBotSignals } from "@/lib/signals/bot-signals";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";

// /live is the scrollable per-position feed - every open paper position
// across the entire roster becomes its own snap-scroll card with the
// $5 / $10 / $20 / $50 stake buttons. Lives behind the elevated ⚡
// button in the bottom nav, and behind the "TAIL <bot>" CTA on /feed.
//
// `?bot=<id>` filters to a single operator (deep-linked from the
// roster cards).
export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ bot?: string }>;
}) {
  if (whaleSocialEnabled()) {
    const positions = await buildWhalePositionSignals();

    return (
      <AppShell railTitle="Whale Live">
        <WhaleLiveFeed initialPositions={positions} />
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
