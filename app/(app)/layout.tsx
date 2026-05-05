import type { ReactNode } from "react";
import { WatchlistProvider } from "@/components/watchlist/WatchlistProvider";

// Pages inside this route group render inside the phone-frame: full-bleed
// on mobile, centered phone-shaped container on desktop. The landing page
// at app/page.tsx sits OUTSIDE this group so it stays full-bleed on every
// viewport.
//
// WatchlistProvider lives at this level so the bookmark state is shared
// between the feed (where you save) and the portfolio (where you read).
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="phone-frame">
      <WatchlistProvider>{children}</WatchlistProvider>
    </div>
  );
}
