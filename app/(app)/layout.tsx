import type { ReactNode } from "react";
import { UserEnsure } from "@/components/auth/UserEnsure";
import { PreferencesProvider } from "@/components/onboarding/PreferencesProvider";
import { WelcomeIntro } from "@/components/welcome/WelcomeIntro";
import { PacificaLiveProvider } from "@/lib/pacifica/live-context";

// Pages inside this route group render inside the phone-frame: full-bleed
// on mobile, centered phone-shaped container on desktop. The landing page
// at app/page.tsx sits OUTSIDE this group so it stays full-bleed on every
// viewport.
//
// UserEnsure — no-op when unauthed; on first authed render syncs the
// user row + solana pubkey via /api/users/me.
// PacificaLiveProvider — single global WS connection feeding live mark
// prices and the trade tape to every page. Bot PnL on /feed and /live
// recomputes from these marks client-side for sub-second updates.
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="phone-frame">
      <UserEnsure />
      <PreferencesProvider>
        <PacificaLiveProvider>{children}</PacificaLiveProvider>
      </PreferencesProvider>
      <WelcomeIntro />
    </div>
  );
}
