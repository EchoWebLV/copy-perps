import { FeedContainer } from "@/components/feed/FeedContainer";
import { mockSignals } from "@/lib/mock-data";

export default function FeedPage() {
  return <FeedContainer signals={mockSignals} />;
}
