"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Signal } from "@/lib/types";

export interface WatchlistItem {
  signalId: string;
  signalType: string;
  payload: Signal;
  addedAt: string;
}

interface WatchlistContextValue {
  items: WatchlistItem[];
  savedIds: Set<string>;
  loading: boolean;
  isSaved: (signalId: string) => boolean;
  toggle: (signal: Signal) => Promise<void>;
  refresh: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Cache items locally so optimistic updates and the row list stay in sync.
  const itemsRef = useRef<WatchlistItem[]>([]);
  itemsRef.current = items;

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const r = await fetch("/api/watchlist", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { items: WatchlistItem[] };
      setItems(data.items ?? []);
    } catch (e) {
      console.error("[watchlist] refresh", e);
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (ready && authenticated) void refresh();
  }, [ready, authenticated, refresh]);

  const savedIds = useMemo(
    () => new Set(items.map((i) => i.signalId)),
    [items],
  );

  const isSaved = useCallback(
    (id: string) => savedIds.has(id),
    [savedIds],
  );

  const toggle = useCallback(
    async (signal: Signal) => {
      if (!authenticated) return;
      const id = signal.id;
      const wasSaved = itemsRef.current.some((i) => i.signalId === id);
      // Optimistic
      if (wasSaved) {
        setItems((prev) => prev.filter((i) => i.signalId !== id));
      } else {
        setItems((prev) => [
          {
            signalId: id,
            signalType: signal.type,
            payload: signal,
            addedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");
        if (wasSaved) {
          const r = await fetch(
            `/api/watchlist?signalId=${encodeURIComponent(id)}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          );
          if (!r.ok) throw new Error(`DELETE ${r.status}`);
        } else {
          const r = await fetch("/api/watchlist", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              signalId: id,
              signalType: signal.type,
              payload: signal,
            }),
          });
          if (!r.ok) throw new Error(`POST ${r.status}`);
        }
      } catch (e) {
        console.error("[watchlist] toggle", e);
        // Rollback by re-fetching truth from server
        void refresh();
      }
    },
    [authenticated, getAccessToken, refresh],
  );

  const value = useMemo<WatchlistContextValue>(
    () => ({ items, savedIds, loading, isSaved, toggle, refresh }),
    [items, savedIds, loading, isSaved, toggle, refresh],
  );

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) {
    // Outside provider — gracefully no-op so the bookmark on a card without
    // a logged-in user / provider doesn't crash.
    return {
      items: [],
      savedIds: new Set(),
      loading: false,
      isSaved: () => false,
      toggle: async () => {},
      refresh: async () => {},
    };
  }
  return ctx;
}
