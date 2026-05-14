"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Pacifica's public WS endpoint.
const WS_URL = "wss://ws.pacifica.fi/ws";
// High-volume markets we tape. Adding lots of symbols floods the strip
// with tiny fills, so keep it to the big movers.
const MARKETS = [
  "SOL",
  "BTC",
  "ETH",
  "HYPE",
  "FARTCOIN",
  "JUP",
  "PUMP",
  "DOGE",
  "XRP",
];
// Cap the visible strip to last N fills, newest on the left.
const MAX_FILLS = 12;
// Don't render dust. $250 keeps the strip readable on busy markets.
const MIN_NOTIONAL_USD = 250;

interface Fill {
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
  timestamp: string | number;
}

interface PacificaWsTradesMessage {
  channel: "trades";
  symbol: string;
  trades: PacificaWsTrade[];
}

function fmtUsd(v: number): string {
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (v >= 1_000) {
    const k = v / 1_000;
    return `$${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${v.toFixed(0)}`;
}

export function LiveTape() {
  const [fills, setFills] = useState<Fill[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (typeof WebSocket === "undefined") return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      for (const symbol of MARKETS) {
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
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (m.channel !== "trades" || !Array.isArray(m.trades)) return;
      const accepted: Fill[] = [];
      for (const t of m.trades) {
        const notional = Number(t.quoteAmount);
        if (!Number.isFinite(notional) || notional < MIN_NOTIONAL_USD) continue;
        accepted.push({
          id: `${t.symbol}:${t.tradeSequenceNumber}`,
          symbol: t.symbol,
          side: t.side,
          notional,
          // Pacifica WS timestamps are seconds as a string.
          timestampMs: Number(t.timestamp) * 1000,
        });
      }
      if (accepted.length === 0) return;
      setFills((prev) => {
        // Prepend newest (within batch already in order). Dedupe by id
        // because Pacifica occasionally re-sends.
        const seen = new Set(prev.map((f) => f.id));
        const merged = [
          ...accepted.filter((f) => !seen.has(f.id)),
          ...prev,
        ];
        return merged.slice(0, MAX_FILLS);
      });
    });

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) return;
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
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
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        // Remove listeners so close() doesn't trigger a reconnect.
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [connect]);

  // Tick "Xs ago" labels every second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  if (fills.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-20 px-3">
      <div className="no-scrollbar flex gap-1.5 overflow-x-hidden">
        {fills.map((f) => (
          <FillChip key={f.id} fill={f} now={now} />
        ))}
      </div>
    </div>
  );
}

function FillChip({ fill, now }: { fill: Fill; now: number }) {
  const isLong = fill.side === "bid";
  const age = Math.max(0, Math.floor((now - fill.timestampMs) / 1000));
  const ageLabel = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold backdrop-blur-md ${
        isLong
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
          : "border-rose-500/30 bg-rose-500/15 text-rose-200"
      }`}
    >
      <span>{fill.symbol}</span>
      <span aria-hidden>{isLong ? "▲" : "▼"}</span>
      <span>{fmtUsd(fill.notional)}</span>
      <span className="text-white/40">{ageLabel}</span>
    </div>
  );
}
