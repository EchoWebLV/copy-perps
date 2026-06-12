"use client";

import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { LeaderboardFeed } from "@/components/leaderboard/LeaderboardFeed";

export default function LeaderboardPage() {
  return (
    <AppShell railTitle="Wins">
      <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-4 lg:max-w-none lg:px-6 lg:pt-5">
        <div className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="pb-24 lg:pb-6">
            <LeaderboardFeed />
          </div>
        </div>
      </div>

      <BottomNav />
    </AppShell>
  );
}
