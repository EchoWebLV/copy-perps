import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhaleRoster } from "@/components/whales/WhaleRoster";

export const dynamic = "force-dynamic";

// /feed is the primary whale list: source accounts, total P/L, open
// positions, and tail actions. The swipeable per-position view lives on /live.
export default function FeedPage() {
  return (
    <AppShell railTitle="Whales" hideEmptyRail>
      <WhaleRoster initialWhales={[]} />
      <BottomNav />
    </AppShell>
  );
}
