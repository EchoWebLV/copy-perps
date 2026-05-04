import { AuthGate } from "@/components/auth/AuthGate";
import { FeedContainer } from "@/components/feed/FeedContainer";
import { getFeedSignals } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const signals = await getFeedSignals(50);

  return (
    <AuthGate>
      <FeedContainer signals={signals} />
    </AuthGate>
  );
}
