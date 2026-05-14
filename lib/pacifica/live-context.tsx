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

interface PacificaWsTrade {
  tradeSequenceNumber: string | number;
  symbol: string;
  side: "bid" | "ask";
  quoteAmount: number;
  baseAmount: number;
  timestamp: string | number;
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
        for (const symbol of SUBSCRIBED_MARKETS) {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              subscription: { channel: "trades", symbol },
            }),
          );
        }
      });

      ws.addEventListener("message", (ev) => {
        let m: { channel?: string; trades?: PacificaWsTrade[] };
        try {
          m = JSON.parse(
            typeof ev.data === "string" ? ev.data : String(ev.data),
          );
        } catch {
          return;
        }
        if (m.channel !== "trades" || !Array.isArray(m.trades)) return;

        // Update marks for every trade (price = quoteAmount / baseAmount).
        const markUpdates: Record<string, number> = {};
        const newFills: LiveFill[] = [];
        for (const t of m.trades) {
          const notional = Number(t.quoteAmount);
          const base = Number(t.baseAmount);
          if (base > 0) markUpdates[t.symbol] = notional / base;

          if (Number.isFinite(notional) && notional >= MIN_TAPE_NOTIONAL_USD) {
            newFills.push({
              id: `${t.symbol}:${t.tradeSequenceNumber}`,
              symbol: t.symbol,
              side: t.side,
              notional,
              timestampMs: Number(t.timestamp) * 1000,
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
