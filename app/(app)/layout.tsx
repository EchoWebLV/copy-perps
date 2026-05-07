import type { ReactNode } from "react";
import { WatchlistProvider } from "@/components/watchlist/WatchlistProvider";
import { AnalyzeProvider } from "@/components/feed/AnalyzeProvider";
import { UserEnsure } from "@/components/auth/UserEnsure";
import { PreferencesProvider } from "@/components/onboarding/PreferencesProvider";

// Pages inside this route group render inside the phone-frame: full-bleed
// on mobile, centered phone-shaped container on desktop. The landing page
// at app/page.tsx sits OUTSIDE this group so it stays full-bleed on every
// viewport.
//
// UserEnsure — no-op when unauthed; on first authed render syncs the
// user row + solana pubkey via /api/users/me.
// WatchlistProvider — bookmark state shared between feed (where you save)
// and portfolio (where you read).
// AnalyzeProvider — Gwak's "live take" modal, openable from any card icon
// in the feed OR from a card opened via the watchlist modal.
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="phone-frame">
      <UserEnsure />
      <PreferencesProvider>
        <WatchlistProvider>
          <AnalyzeProvider>{children}</AnalyzeProvider>
        </WatchlistProvider>
      </PreferencesProvider>
    </div>
  );
}
