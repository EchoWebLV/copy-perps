"use client";

import { useEffect, useState } from "react";

// Module-level caches survive component unmount/remount but reset on
// page reload. Keys are mint address / Jupiter event id.
export interface JupTokenInfo {
  icon: string | null;
  mcap: number | null;
}
const EMPTY_TOKEN_INFO: JupTokenInfo = { icon: null, mcap: null };
const tokenInfoCache = new Map<string, JupTokenInfo>();
const eventImageCache = new Map<string, string | null>();

interface JupTokenSearchEntry {
  id: string;
  icon?: string | null;
  mcap?: number | null;
  fdv?: number | null;
}

// `/prediction/v1/events/{id}` returns the event at the top level, NOT
// wrapped in `{ data: ... }` like the list endpoint does.
interface JupEventResponse {
  metadata?: { imageUrl?: string | null };
  markets?: { marketId: string; imageUrl?: string | null }[];
}

export function useJupiterTokenInfo(mint: string | undefined): JupTokenInfo {
  const initial =
    mint && tokenInfoCache.has(mint)
      ? tokenInfoCache.get(mint)!
      : EMPTY_TOKEN_INFO;
  const [info, setInfo] = useState<JupTokenInfo>(initial);

  useEffect(() => {
    if (!mint) return;
    if (tokenInfoCache.has(mint)) {
      setInfo(tokenInfoCache.get(mint) ?? EMPTY_TOKEN_INFO);
      return;
    }
    let cancelled = false;
    fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((arr: JupTokenSearchEntry[]) => {
        const hit = arr.find((e) => e.id === mint);
        const next: JupTokenInfo = {
          icon: hit?.icon ?? null,
          mcap: hit?.mcap ?? hit?.fdv ?? null,
        };
        tokenInfoCache.set(mint, next);
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        tokenInfoCache.set(mint, EMPTY_TOKEN_INFO);
        if (!cancelled) setInfo(EMPTY_TOKEN_INFO);
      });
    return () => {
      cancelled = true;
    };
  }, [mint]);

  return info;
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
      .then((ev: JupEventResponse) => {
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
