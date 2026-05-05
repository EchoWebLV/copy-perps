import type { ReactNode } from "react";

// Pages inside this route group render inside the phone-frame: full-bleed
// on mobile, centered phone-shaped container on desktop. The landing page
// at app/page.tsx sits OUTSIDE this group so it stays full-bleed on every
// viewport.
export default function ContainedLayout({ children }: { children: ReactNode }) {
  return <div className="phone-frame">{children}</div>;
}
