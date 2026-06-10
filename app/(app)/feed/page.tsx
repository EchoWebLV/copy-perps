import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleRoster } from "@/components/whales/WhaleRoster";
import { whaleSocialEnabled } from "@/lib/features";
import { buildCompactRosterWithTimeout } from "@/lib/signals/roster-compact";

export const dynamic = "force-dynamic";

// When the stats cache is warm this paints the roster on first byte instead
// of a loading screen; when cold, SSR gives up fast and the client skeleton
// + poll takes over.
const SSR_ROSTER_BUDGET_MS = 1500;

// /feed is the primary whale list: source accounts, total P/L, open
// positions, and tail actions. The swipeable per-position view lives on /live.
export default async function FeedPage() {
  const initialWhales = whaleSocialEnabled()
    ? await buildCompactRosterWithTimeout(SSR_ROSTER_BUDGET_MS)
    : [];

  return (
    <AppShell railTitle="Whales" hideEmptyRail>
      <WhaleRoster initialWhales={initialWhales} />
      <BottomNav />
    </AppShell>
  );
}
