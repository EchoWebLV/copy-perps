"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initPostHog, trackPageview } from "@/lib/analytics";

// Client init runs at module load — the moment this file is imported on
// the client we have a working posthog instance (assuming the env key is
// set). No env key = no-op throughout.
initPostHog();

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    let url = window.location.origin + pathname;
    const sp = searchParams?.toString();
    if (sp) url += "?" + sp;
    trackPageview(url);
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* useSearchParams in App Router opts a tree into client rendering
          unless wrapped in Suspense. The tracker is null-rendering so the
          fallback never matters. */}
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}
