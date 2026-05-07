import { FeedContainer } from "@/components/feed/FeedContainer";
import { BottomNav } from "@/components/shell/BottomNav";
import { getFeedPool } from "@/lib/feed/pool";
import { interleaveByRail, randomSeed } from "@/lib/feed/shuffle";

export const dynamic = "force-dynamic";

const INITIAL_BATCH = 20;

// Feed is public — anyone can scroll and read. Action buttons (stake,
// bookmark, "ask Gwak") prompt login on tap when the user isn't signed
// in. UserEnsure runs at the (app)/layout level so it still syncs the
// user row on the first authed visit, regardless of which page they
// land on.
export default async function FeedPage() {
  const seed = randomSeed();
  const pool = await getFeedPool();
  const shuffled = interleaveByRail(pool, seed);
  const initial = shuffled.slice(0, INITIAL_BATCH);

  return (
    <>
      <FeedContainer
        initialSignals={initial}
        initialSeed={seed.toString()}
        initialCursor={INITIAL_BATCH}
        initialTotal={shuffled.length}
      />
      <BottomNav />
    </>
  );
}
