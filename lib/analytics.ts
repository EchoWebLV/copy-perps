"use client";

// Thin wrapper over posthog-js. All calls are no-ops on the server or
// before init (e.g. NEXT_PUBLIC_POSTHOG_KEY missing) — safe to sprinkle
// anywhere without guarding the call site.
//
// Pageviews are captured manually from the provider because Next.js App
// Router doesn't fire route-change events that posthog-js can hook into
// on its own. See components/providers/PostHogProvider.tsx.

import posthog from "posthog-js";

let initted = false;

export function initPostHog() {
  if (initted || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.warn("[PostHog] NEXT_PUBLIC_POSTHOG_KEY missing — analytics disabled");
    return;
  }

  posthog.init(key, {
    // Reverse-proxied through /ingest in next.config.ts so ad blockers
    // (uBlock, Brave shields) don't eat events. The crypto audience runs
    // these heavily — direct posthog.com hits get dropped.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    autocapture: true,
  });
  initted = true;
}

type Rail = "meme" | "prediction" | "multiprediction" | "whale";

interface BaseProps {
  [key: string]: unknown;
}

export function track(event: string, properties?: BaseProps) {
  if (!initted || typeof window === "undefined") return;
  posthog.capture(event, properties);
}

export function trackPageview(url: string) {
  if (!initted || typeof window === "undefined") return;
  posthog.capture("$pageview", { $current_url: url });
}

export function identifyUser(
  id: string,
  properties?: { solana_pubkey?: string | null; email?: string | null },
) {
  if (!initted || typeof window === "undefined") return;
  posthog.identify(id, properties as Record<string, unknown>);
}

export function resetUser() {
  if (!initted || typeof window === "undefined") return;
  posthog.reset();
}

// Bet funnel — keep names stable; PostHog dashboards will key off these.
export const ev = {
  loginClicked: (source: string) => track("login_clicked", { source }),
  authCompleted: (props: { method?: string }) => track("auth_completed", props),

  // Fires the moment a stake button is tapped, regardless of auth or
  // wallet state. bet_started only fires after preflight passes — this
  // captures the full top-of-funnel including users who bail at the
  // login modal or the wallet sign sheet.
  stakeButtonClicked: (
    rail: Rail,
    props: {
      signal_id: string;
      amount_usdc: number;
      side?: string;
      authenticated: boolean;
    },
  ) => track("stake_button_clicked", { rail, ...props }),

  betStarted: (
    rail: Rail,
    props: { signal_id: string; amount_usdc: number; side?: string },
  ) => track("bet_started", { rail, ...props }),
  betConsolidating: (rail: Rail, props: { amount_usdc: number }) =>
    track("bet_consolidating", { rail, ...props }),
  betSigned: (
    rail: Rail,
    props: { bet_id: string; amount_usdc: number; tx_hash: string },
  ) => track("bet_signed", { rail, ...props }),
  betConfirmed: (
    rail: Rail,
    props: { bet_id: string; amount_usdc: number; tx_hash: string },
  ) => track("bet_confirmed", { rail, ...props }),
  betFailed: (
    rail: Rail,
    props: { bet_id?: string; amount_usdc: number; error: string },
  ) => track("bet_failed", { rail, ...props }),

  depositAddressCopied: () => track("deposit_address_copied"),

  withdrawStarted: (props: { amount_usd: number }) =>
    track("withdraw_started", props),
  withdrawConfirmed: (props: { amount_usd: number; tx_hash: string }) =>
    track("withdraw_confirmed", props),
  withdrawFailed: (props: { amount_usd: number; error: string }) =>
    track("withdraw_failed", props),
};
