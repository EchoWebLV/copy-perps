"use client";

import { useEffect, useState } from "react";

// Module-level caches survive component unmount/remount but reset on
// page reload. Keys are mint address / Jupiter event id; values are
// resolved icon URLs or null when the upstream had nothing for us.
const tokenIconCache = new Map<string, string | null>();
const eventImageCache = new Map<string, string | null>();

interface JupTokenSearchEntry {
  id: string;
  icon?: string | null;
}

interface JupEventResponse {
  data?: {
    metadata?: { imageUrl?: string | null };
    markets?: { marketId: string; imageUrl?: string | null }[];
  };
}

export function useJupiterTokenIcon(mint: string | undefined): string | null {
  const initial = mint && tokenIconCache.has(mint) ? tokenIconCache.get(mint)! : null;
  const [icon, setIcon] = useState<string | null>(initial);

  useEffect(() => {
    if (!mint) return;
    if (tokenIconCache.has(mint)) {
      setIcon(tokenIconCache.get(mint) ?? null);
      return;
    }
    let cancelled = false;
    fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((arr: JupTokenSearchEntry[]) => {
        const url = arr.find((e) => e.id === mint)?.icon ?? null;
        tokenIconCache.set(mint, url);
        if (!cancelled) setIcon(url);
      })
      .catch(() => {
        tokenIconCache.set(mint, null);
        if (!cancelled) setIcon(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mint]);

  return icon;
}

export function useJupiterEventImage(
  eventId: string | undefined,
  marketId?: string,
): string | null {
  const cacheKey = eventId ? `${eventId}:${marketId ?? ""}` : "";
  const initial =
    cacheKey && eventImageCache.has(cacheKey)
      ? eventImageCache.get(cacheKey)!
      : null;
  const [icon, setIcon] = useState<string | null>(initial);

  useEffect(() => {
    if (!eventId) return;
    if (eventImageCache.has(cacheKey)) {
      setIcon(eventImageCache.get(cacheKey) ?? null);
      return;
    }
    let cancelled = false;
    fetch(`https://api.jup.ag/prediction/v1/events/${eventId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((res: JupEventResponse) => {
        const ev = res?.data;
        const marketImg = marketId
          ? ev?.markets?.find((m) => m.marketId === marketId)?.imageUrl
          : null;
        const url = marketImg ?? ev?.metadata?.imageUrl ?? null;
        eventImageCache.set(cacheKey, url);
        if (!cancelled) setIcon(url);
      })
      .catch(() => {
        eventImageCache.set(cacheKey, null);
        if (!cancelled) setIcon(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, eventId, marketId]);

  return icon;
}
