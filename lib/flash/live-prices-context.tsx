"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  parsePythPriceUpdate,
  type FlashLiveMark,
  type FlashLivePriceSymbol,
} from "./live-prices";
import {
  FLASH_ORACLE_FEED_PDAS,
  decodeLazerFeed,
  mergeMark,
} from "./oracle-marks";

type FlashLiveMarks = Partial<Record<FlashLivePriceSymbol, FlashLiveMark>>;

interface FlashLivePriceContextValue {
  marks: FlashLiveMarks;
  /** Wall-clock ms of the last mark delivered by the ER oracle ws
   *  (0 = never). Operational signal — lets UI distinguish oracle-fed from
   *  SSE-fallback honestly if it ever needs to. */
  lastOracleDeliveryMs: number;
}

const FlashLivePriceContext = createContext<FlashLivePriceContextValue>({
  marks: {},
  lastOracleDeliveryMs: 0,
});

/** ER pushes arrive every ~50ms per feed; rendering each one would re-render
 *  every consumer ~60×/s. Buffer in refs and flush on this cadence — fast
 *  enough to read as live, 10× fewer renders. */
export const ORACLE_FLUSH_MS = 120;

// Module-level Connection singleton on the ER endpoint (same pattern as
// lib/arena/use-arena-live.ts). "processed": the ER is a single validator —
// take the freshest state. Endpoint is shared with the arena (same ER).
const DEFAULT_ER_ENDPOINT = "https://eu.magicblock.app";
let cachedConn: Connection | null = null;
let cachedEndpoint: string | null = null;
function getErConnection(endpoint: string): Connection {
  if (!cachedConn || cachedEndpoint !== endpoint) {
    cachedConn = new Connection(endpoint, "processed");
    cachedEndpoint = endpoint;
  }
  return cachedConn;
}

export function FlashLivePriceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [marks, setMarks] = useState<FlashLiveMarks>({});
  const [lastOracleDeliveryMs, setLastOracleDeliveryMs] = useState(0);
  // Logs "oracle live" exactly once per mount (operational breadcrumb).
  const oracleSeenRef = useRef(false);
  // Throttle buffers: latest pending mark per symbol + delivery accounting.
  const pendingMarksRef = useRef<FlashLiveMarks>({});
  const pendingDeliveryMsRef = useRef(0);

  // Single flush loop for both sources: applies the freshest buffered mark
  // per symbol at most every ORACLE_FLUSH_MS.
  useEffect(() => {
    const id = setInterval(() => {
      const pending = pendingMarksRef.current;
      const pendingDeliveryMs = pendingDeliveryMsRef.current;
      if (Object.keys(pending).length === 0 && pendingDeliveryMs === 0) return;
      pendingMarksRef.current = {};
      pendingDeliveryMsRef.current = 0;
      if (Object.keys(pending).length > 0) {
        setMarks((current) => {
          const merged: FlashLiveMarks = { ...current };
          for (const [symbol, mark] of Object.entries(pending) as Array<
            [FlashLivePriceSymbol, FlashLiveMark]
          >) {
            merged[symbol] = mergeMark(current[symbol], mark);
          }
          return merged;
        });
      }
      if (pendingDeliveryMs > 0) {
        setLastOracleDeliveryMs(pendingDeliveryMs);
      }
    }, ORACLE_FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  const buffer = (symbol: FlashLivePriceSymbol, mark: FlashLiveMark) => {
    const cur = pendingMarksRef.current[symbol];
    pendingMarksRef.current[symbol] = cur ? mergeMark(cur, mark) : mark;
  };

  // Source 1 — Pyth Hermes via our SSE proxy. Kept as the always-on fallback:
  // it auto-reconnects and serves browsers/regions where the ER ws path is
  // unavailable. Freshest-wins merge means it never regresses an ER mark.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/flash/perp/prices/stream");

    source.onmessage = (event) => {
      const nextMarks = parsePythPriceUpdate(event.data);
      for (const [symbol, mark] of Object.entries(nextMarks) as Array<
        [FlashLivePriceSymbol, FlashLiveMark]
      >) {
        buffer(symbol, mark);
      }
    };

    source.onerror = () => {
      // EventSource reconnects automatically. Keep the previous marks visible.
    };

    return () => {
      source.close();
    };
  }, []);

  // Source 2 — MagicBlock ER Lazer feeds, ~50ms pushes straight from the
  // rollup (the oracle tier Flash executes against). Subscriptions are
  // best-effort: a dead ws path just leaves SSE as the live source, and a
  // late delivery silently upgrades freshness via mergeMark.
  useEffect(() => {
    const endpoint =
      process.env.NEXT_PUBLIC_ARENA_ER_ENDPOINT?.trim() || DEFAULT_ER_ENDPOINT;
    const conn = getErConnection(endpoint);

    let mounted = true;
    const subIds: number[] = [];

    for (const [symbol, address] of Object.entries(
      FLASH_ORACLE_FEED_PDAS,
    ) as Array<[FlashLivePriceSymbol, string]>) {
      let feedKey: PublicKey;
      try {
        feedKey = new PublicKey(address);
      } catch {
        continue; // fail-closed: skip a malformed address, keep the rest
      }
      subIds.push(
        conn.onAccountChange(
          feedKey,
          (info) => {
            if (!mounted) return;
            const mark = decodeLazerFeed(info.data);
            if (!mark) return; // fail-closed on malformed account data
            if (!oracleSeenRef.current) {
              oracleSeenRef.current = true;
              console.info(
                `[flash] ER oracle marks live (${symbol} $${mark.priceUsd.toFixed(2)} via ${endpoint})`,
              );
            }
            buffer(symbol, mark);
            pendingDeliveryMsRef.current = Date.now();
          },
          { commitment: "processed" },
        ),
      );
    }

    return () => {
      mounted = false;
      for (const id of subIds) {
        void conn.removeAccountChangeListener(id);
      }
    };
  }, []);

  const value = useMemo(
    () => ({ marks, lastOracleDeliveryMs }),
    [marks, lastOracleDeliveryMs],
  );
  return (
    <FlashLivePriceContext.Provider value={value}>
      {children}
    </FlashLivePriceContext.Provider>
  );
}

export function useFlashLiveMarks(): FlashLiveMarks {
  return useContext(FlashLivePriceContext).marks;
}

/** Wall-clock ms of the last ER-oracle mark delivery (0 = never). */
export function useFlashOracleDeliveryMs(): number {
  return useContext(FlashLivePriceContext).lastOracleDeliveryMs;
}
