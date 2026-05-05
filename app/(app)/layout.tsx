import type { ReactNode } from "react";
import { WatchlistProvider } from "@/components/watchlist/WatchlistProvider";
import { AnalyzeProvider } from "@/components/feed/AnalyzeProvider";

// Pages inside this route group render inside the phone-frame: full-bleed
// on mobile, centered phone-shaped container on desktop. The landing page
// at app/page.tsx sits OUTSIDE this group so it stays full-bleed on every
// viewport.
//
// WatchlistProvider — bookmark state shared between feed (where you save)
// and portfolio (where you read).
// AnalyzeProvider — Gwak's "live take" modal, openable from any card icon
// in the feed OR from a card opened via the watchlist modal.
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="phone-frame">
      <WatchlistProvider>
        <AnalyzeProvider>{children}</AnalyzeProvider>
      </WatchlistProvider>
    </div>
  );
}
