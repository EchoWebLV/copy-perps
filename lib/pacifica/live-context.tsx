"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const WS_URL = "wss://ws.pacifica.fi/ws";

// Markets we subscribe to. Covers the high-volume majors plus the
// long tail seen in Pacifica's leaderboard. More markets = more mark
// price coverage for live PnL on cards. Pacifica's WS handles all of
// these on a single connection.
const SUBSCRIBED_MARKETS = [
  // Crypto majors
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "SUI", "TON", "AAVE", "NEAR",
  "AVAX", "LINK", "ARB", "OP", "TAO", "HYPE",
  // Solana memes / liquid alts
  "JUP", "PUMP", "FARTCOIN", "JTO", "ENA",
  // Metals
  "XAG", "XAU", "SILVER", "GOLD",
  // Equities / stocks
  "TSLA", "NVDA", "SP500", "CRCL", "URNM",
];

// Tape filter: don't add tiny fills to the LiveTape strip.
const MIN_TAPE_NOTIONAL_USD = 250;
const MAX_TAPE_FILLS = 12;

export interface LiveFill {
  id: string;
  symbol: string;
  side: "bid" | "ask";
  notional: number;
  timestampMs: number;
}

// Pacifica WS trade row (channel "trades"). Compact keys, all strings
// for numerics: h=sequence, s=symbol, a=base amount, p=price,
// d=taker direction (open_long/close_long/open_short/close_short),
// t=timestamp in ms.
interface PacificaWsTrade {
  h: number;
  s: string;
  a: string;
  p: string;
  d: string;
  t: number;
}

// Pacifica WS price row (channel "prices"). One entry per market,
// delivered in batches. `mark` is the mark price we display.
interface PacificaWsPrice {
  symbol: string;
  mark: string;
  mid: string;
  oracle: string;
  timestamp: number;
}

interface LiveContextValue {
  fills: LiveFill[];
  // Last seen mark price per symbol. Updated on every trade message.
  marks: Record<string, number>;
}

const LiveContext = createContext<LiveContextValue>({
  fills: [],
  marks: {},
});

export function PacificaLiveProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fills, setFills] = useState<LiveFill[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return;
    let alive = true;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        // "prices" — a single subscription that streams every market's
        // mark price in batches (~3s cadence). This is the baseline:
        // it covers low-volume symbols (gold, equities) that rarely
        // print a trade, and doesn't depend on SUBSCRIBED_MARKETS being
        // an exact match for Pacifica's symbol list.
        ws.send(
          JSON.stringify({
            method: "subscribe",
            params: { source: "prices" },
          }),
        );
        // "trades" — per-symbol last-trade prints. Sub-second updates on
        // liquid markets (BTC/ETH/SOL); this is what makes the cards
        // flash continuously rather than every few seconds.
        for (const symbol of SUBSCRIBED_MARKETS) {
          ws.send(
            JSON.stringify({
              method: "subscribe",
              params: { source: "trades", symbol },
            }),
          );
        }
      });

      ws.addEventListener("message", (ev) => {
        let m: { channel?: string; data?: unknown };
        try {
          m = JSON.parse(
            typeof ev.data === "string" ? ev.data : String(ev.data),
          );
        } catch {
          return;
        }

        // "prices" — batched mark prices. Baseline coverage for every
        // market, including the slow ones that rarely trade.
        if (m.channel === "prices" && Array.isArray(m.data)) {
          const markUpdates: Record<string, number> = {};
          for (const row of m.data as PacificaWsPrice[]) {
            const mark = Number(row.mark);
            if (row.symbol && Number.isFinite(mark)) {
              markUpdates[row.symbol] = mark;
            }
          }
          if (Object.keys(markUpdates).length > 0) {
            setMarks((prev) => ({ ...prev, ...markUpdates }));
          }
          return;
        }

        // "trades" — last-trade prints. Drives sub-second mark updates
        // on liquid markets plus the LiveTape fills strip.
        if (m.channel === "trades" && Array.isArray(m.data)) {
          const markUpdates: Record<string, number> = {};
          const newFills: LiveFill[] = [];
          for (const t of m.data as PacificaWsTrade[]) {
            const price = Number(t.p);
            const base = Number(t.a);
            if (t.s && Number.isFinite(price)) markUpdates[t.s] = price;

            const notional = price * base;
            // Taker direction → tape side. A taker opening a long or
            // closing a short is buying (bid); the inverse is selling.
            const isBuy = t.d === "open_long" || t.d === "close_short";
            if (
              Number.isFinite(notional) &&
              notional >= MIN_TAPE_NOTIONAL_USD
            ) {
              newFills.push({
                id: `${t.s}:${t.h}`,
                symbol: t.s,
                side: isBuy ? "bid" : "ask",
                notional,
                timestampMs: Number(t.t),
              });
            }
          }
          if (Object.keys(markUpdates).length > 0) {
            setMarks((prev) => ({ ...prev, ...markUpdates }));
          }
          if (newFills.length > 0) {
            setFills((prev) => {
              const seen = new Set(prev.map((f) => f.id));
              const merged = [
                ...newFills.filter((f) => !seen.has(f.id)),
                ...prev,
              ];
              return merged.slice(0, MAX_TAPE_FILLS);
            });
          }
          return;
        }
      });

      const scheduleReconnect = () => {
        if (!alive) return;
        if (reconnectTimeoutRef.current) return;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (alive) connect();
        }, 2_000);
      };

      ws.addEventListener("close", scheduleReconnect);
      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const value = useMemo(() => ({ fills, marks }), [fills, marks]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveFills(): LiveFill[] {
  return useContext(LiveContext).fills;
}

export function useLiveMark(symbol: string): number | undefined {
  return useContext(LiveContext).marks[symbol];
}

/** All currently-known live marks, keyed by symbol. Use this when a
 *  component needs marks for an arbitrary set of positions (e.g. live
 *  PnL across a bot's whole position list) without violating the rules
 *  of hooks by calling useLiveMark inside a map. */
export function useLiveMarks(): Record<string, number> {
  return useContext(LiveContext).marks;
}
