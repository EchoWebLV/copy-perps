import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { WhalePulseFeed } from "@/components/whales/WhalePulseFeed";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export default async function ChatterPage() {
  const positions = await buildWhalePositionSignals(1000);

  return (
    <AppShell railTitle="Live" hideEmptyRail>
      <WhalePulseFeed initialPositions={positions} />
      <BottomNav />
    </AppShell>
  );
}
