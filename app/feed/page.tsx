import { AuthGate } from "@/components/auth/AuthGate";
import { FeedContainer } from "@/components/feed/FeedContainer";
import { mockSignals } from "@/lib/mock-data";

export default function FeedPage() {
  return (
    <AuthGate>
      <FeedContainer signals={mockSignals} />
    </AuthGate>
  );
}
