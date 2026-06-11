import type { Metadata } from "next";
import { ArenaRoster } from "@/components/arena/ArenaRoster";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";

export const metadata: Metadata = {
  title: "Arena — gwak",
};

// /arena renders the on-chain strategy bots straight from Ephemeral Rollup
// account state. No SSR fetch in this phase — the chain IS the API — so the
// page paints the skeleton immediately and the client hook (REST seed →
// ws / poll fallback) fills the cards in.
export default function ArenaPage() {
  return (
    <AppShell railTitle="Arena" hideEmptyRail>
      <ArenaRoster />
      <BottomNav />
    </AppShell>
  );
}
