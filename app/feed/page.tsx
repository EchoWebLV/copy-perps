import { AuthGate } from "@/components/auth/AuthGate";
import { FeedContainer } from "@/components/feed/FeedContainer";
import { BottomNav } from "@/components/shell/BottomNav";
import { getFeedPool } from "@/lib/feed/pool";
import { seededShuffle, randomSeed } from "@/lib/feed/shuffle";

export const dynamic = "force-dynamic";

const INITIAL_BATCH = 10;

export default async function FeedPage() {
  const seed = randomSeed();
  const pool = await getFeedPool();
  const shuffled = seededShuffle(pool, seed);
  const initial = shuffled.slice(0, INITIAL_BATCH);

  return (
    <>
      <AuthGate>
        <FeedContainer
          initialSignals={initial}
          initialSeed={seed.toString()}
          initialCursor={INITIAL_BATCH}
          initialTotal={shuffled.length}
        />
      </AuthGate>
      <BottomNav />
    </>
  );
}
