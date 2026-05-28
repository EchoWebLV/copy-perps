import { BottomNav } from "@/components/shell/BottomNav";
import { AppShell } from "@/components/shell/AppShell";
import { FastPerpsGame } from "@/components/trade/FastPerpsGame";

export const dynamic = "force-dynamic";

export default function TradePage() {
  return (
    <AppShell railTitle="Trade">
      <FastPerpsGame />
      <BottomNav />
    </AppShell>
  );
}
