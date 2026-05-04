"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

export function UserEnsure() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const lastSyncedAddress = useRef<string | null>(null);

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
        }
      } catch (e) {
        console.error("[UserEnsure]", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, wallet?.address, getAccessToken]);

  return null;
}
