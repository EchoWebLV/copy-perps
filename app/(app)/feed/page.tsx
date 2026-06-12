import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { UnifiedFeed } from "@/components/feed/UnifiedFeed";
import { whaleSocialEnabled } from "@/lib/features";
import { buildCompactRosterWithTimeout } from "@/lib/signals/roster-compact";

export const dynamic = "force-dynamic";

// When the stats cache is warm this paints the roster on first byte instead
// of a loading screen; when cold, SSR gives up fast and the client skeleton
// + poll takes over.
const SSR_ROSTER_BUDGET_MS = 1500;

// /feed is the unified feed: whale source accounts AND on-chain arena bots
// as one stacked-card list, filtered by entity pills with a compact
// 1D/7D/30D/Equity sort. Bots hydrate client-side from the ER (the chain
// is the API); whales SSR from the stats cache when it's warm.
export default async function FeedPage() {
  const initialWhales = whaleSocialEnabled()
    ? await buildCompactRosterWithTimeout(SSR_ROSTER_BUDGET_MS)
    : [];

  return (
    <AppShell railTitle="Traders" hideEmptyRail>
      <UnifiedFeed initialWhales={initialWhales} />
      <BottomNav />
    </AppShell>
  );
}
