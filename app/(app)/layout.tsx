import type { ReactNode } from "react";
import { UserEnsure } from "@/components/auth/UserEnsure";
import { PreferencesProvider } from "@/components/onboarding/PreferencesProvider";
import { FlashLivePriceProvider } from "@/lib/flash/live-prices-context";
import { PacificaLiveProvider } from "@/lib/pacifica/live-context";

// Pages inside this route group render inside the app-frame: full-screen on
// mobile and command-center sized on desktop. The landing page at app/page.tsx
// sits OUTSIDE this group so it stays full-bleed on every viewport.
//
// UserEnsure — no-op when unauthed; on first authed render syncs the
// user row + solana pubkey via /api/users/me.
// PacificaLiveProvider — single global WS connection feeding live mark
// prices and the trade tape to every page. Bot PnL on /feed and /live
// recomputes from these marks client-side for sub-second updates.
// FlashLivePriceProvider: single Pyth Hermes SSE connection feeding Flash
// Scalp marks so perps PnL can update locally between exact Flash quotes.
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <UserEnsure />
      <PreferencesProvider>
        <PacificaLiveProvider>
          <FlashLivePriceProvider>{children}</FlashLivePriceProvider>
        </PacificaLiveProvider>
      </PreferencesProvider>
    </div>
  );
}
