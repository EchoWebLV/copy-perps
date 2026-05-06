"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { ev, identifyUser, resetUser } from "@/lib/analytics";

export function UserEnsure() {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const lastSyncedAddress = useRef<string | null>(null);

  // Reset PostHog identity on logout so the next user starts a fresh
  // distinct_id instead of inheriting the previous session.
  useEffect(() => {
    if (ready && !authenticated) {
      resetUser();
      lastSyncedAddress.current = null;
    }
  }, [ready, authenticated]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const address = wallet?.address ?? null;
    if (lastSyncedAddress.current === address) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const r = await fetch("/api/users/me", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ solanaPubkey: address }),
        });
        if (!cancelled && r.ok) {
          lastSyncedAddress.current = address;
          if (user?.id) {
            identifyUser(user.id, {
              solana_pubkey: address,
              email: user.email?.address ?? null,
            });
            ev.authCompleted({
              method: user.linkedAccounts?.[0]?.type,
            });
          }
        }
      } catch (e) {
        console.error("[UserEnsure]", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, wallet?.address, getAccessToken, user]);

  return null;
}
