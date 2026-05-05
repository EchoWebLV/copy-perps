"use client";

import { useEffect, useState } from "react";

// Pyth price-feed IDs for the assets Flash supports. Matches what
// flash-sdk uses server-side, but Hermes is a public REST endpoint we
// can hit from the browser at no cost / no auth — perfect for a 5s
// poll on whale cards. Adding a new asset means adding its ID here.
const PYTH_IDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

const POLL_MS = 5_000;

// Returns the live mark price (USD) for a Flash-supported asset, or
// null while loading / for unsupported assets. Polls Pyth Hermes every
// 5s while the tab is visible; pauses when document.hidden so we
// don't burn battery on backgrounded tabs.
export function usePerpPrice(asset: string | undefined): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    if (!asset) return;
    const id = PYTH_IDS[asset.toUpperCase()];
    if (!id) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      try {
        const r = await fetch(
          `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          parsed?: Array<{
            price?: { price?: string; expo?: number };
          }>;
        };
        const p = data.parsed?.[0]?.price;
        if (!p?.price || typeof p.expo !== "number") return;
        const value = Number(p.price) * Math.pow(10, p.expo);
        if (!cancelled && Number.isFinite(value) && value > 0) {
          setPrice(value);
        }
      } catch {
        // Network blip — keep showing the last known price.
      }
    };

    const start = () => {
      if (timer) return;
      void fetchOnce();
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void fetchOnce();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (typeof document !== "undefined" && !document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [asset]);

  return price;
}
