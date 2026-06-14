"use client";

import { useCallback, useEffect, useState } from "react";

type Decision = {
  action: "open" | "close" | "hold";
  side: "long" | "short";
  asset: string;
  leverage: number;
  stakeFracPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  confidence: number;
  reasoning: string;
};
type Outcome =
  | { kind: "send"; args: { leverage: number; stakeFracBps: number; stopBps: number; tpBps: number; confidence: number; side: number } }
  | { kind: "skip"; reason: string };
type Bot = {
  persona: string;
  displayName: string;
  avatarEmoji: string;
  provider: string;
  modelId: string;
  status: "ok" | "no-key" | "error";
  latencyMs?: number;
  decision?: Decision;
  outcome?: Outcome;
};
type Market = {
  asset: string;
  price: number | null;
  change1hPct: number | null;
  rsi14: number | null;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  longPct: number | null;
  shortPct: number | null;
  bias: string | null;
};
type Resp = { builtAt: string; markets: Market[]; sentiment: { score: number; summary: string } | null; bots: Bot[] };

const money = (n: number | null) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;

export default function LlmArenaPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/arena/llm", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Resp);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e7e7ea", padding: "24px 18px", fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🤖 LLM Oracle Bots — live</h1>
          <button
            onClick={run}
            disabled={loading}
            style={{ background: loading ? "#3a3a44" : "#6d5efc", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: loading ? "default" : "pointer" }}
          >
            {loading ? "Thinking…" : "Run a round"}
          </button>
        </div>
        <p style={{ color: "#9a9aa6", fontSize: 13, marginTop: 6 }}>
          Each model reads the same brief (price · RSI · MACD · funding · OI · long/short · sentiment) and returns a
          structured trade. The on-chain <b>safety floor</b> then clamps/vetoes it — exactly what lands on-chain.
        </p>

        {data?.markets && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0", fontSize: 12.5 }}>
            {data.markets.map((m) => (
              <div key={m.asset} style={{ background: "#14141c", borderRadius: 10, padding: "8px 12px", border: "1px solid #23232e" }}>
                <b>{m.asset}</b> ${m.price?.toLocaleString()} ·{" "}
                <span style={{ color: (m.change1hPct ?? 0) >= 0 ? "#36d399" : "#f87272" }}>
                  {(m.change1hPct ?? 0) >= 0 ? "+" : ""}{m.change1hPct}%
                </span>{" "}
                · RSI {m.rsi14} · OI {money(m.openInterestUsd)} · L/S {m.longPct}/{m.shortPct}
              </div>
            ))}
          </div>
        )}

        {err && <div style={{ color: "#f87272", margin: "12px 0" }}>Error: {err}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginTop: 8 }}>
          {(data?.bots ?? []).map((b) => (
            <BotCard key={b.persona} bot={b} />
          ))}
          {!data && loading && <div style={{ color: "#9a9aa6" }}>Asking Claude and Grok…</div>}
        </div>

        {data?.builtAt && (
          <p style={{ color: "#5a5a66", fontSize: 11, marginTop: 18 }}>snapshot {data.builtAt} · demo brief (static)</p>
        )}
      </div>
    </div>
  );
}

function BotCard({ bot }: { bot: Bot }) {
  const d = bot.decision;
  const o = bot.outcome;
  const actionColor = d?.action === "hold" ? "#9a9aa6" : d?.side === "long" ? "#36d399" : "#f87272";
  return (
    <div style={{ background: "#13131b", border: "1px solid #25252f", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 26 }}>{bot.avatarEmoji}</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{bot.displayName}</div>
          <div style={{ color: "#7a7a86", fontSize: 12 }}>{bot.modelId}{bot.latencyMs ? ` · ${(bot.latencyMs / 1000).toFixed(1)}s` : ""}</div>
        </div>
        {d && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <span style={{ color: actionColor, fontWeight: 800, fontSize: 15 }}>
              {d.action === "hold" ? "HOLD" : `${d.action.toUpperCase()} ${d.side.toUpperCase()} ${d.asset}`}
            </span>
            {d.action === "open" && (
              <div style={{ color: "#9a9aa6", fontSize: 12 }}>
                {d.leverage}x · {(d.stakeFracPct * 100).toFixed(0)}% · stop {(d.stopLossPct * 100).toFixed(1)}% · tp {(d.takeProfitPct * 100).toFixed(1)}%
              </div>
            )}
            <div style={{ color: "#7a7a86", fontSize: 11 }}>confidence {d ? d.confidence.toFixed(2) : "—"}</div>
          </div>
        )}
      </div>

      {bot.status === "no-key" && <div style={{ color: "#e0a23c", marginTop: 10, fontSize: 13 }}>No API key for {bot.provider} — set it in .env.local</div>}
      {bot.status === "error" && <div style={{ color: "#f87272", marginTop: 10, fontSize: 13 }}>Model error (invalid/failed generation)</div>}

      {d && (
        <p style={{ margin: "12px 0 10px", lineHeight: 1.45, fontSize: 14, color: "#cfcfd6" }}>“{d.reasoning}”</p>
      )}

      {o && (
        <div style={{ borderTop: "1px solid #25252f", paddingTop: 10, fontSize: 13 }}>
          {o.kind === "send" ? (
            <span style={{ color: "#36d399", fontWeight: 700 }}>
              ✓ FLOOR PASS → apply_decision · {o.args.leverage}x · stop {(o.args.stopBps / 100).toFixed(1)}% · {(o.args.stakeFracBps / 100).toFixed(0)}% stake
            </span>
          ) : (
            <span style={{ color: o.reason === "Hold" ? "#9a9aa6" : "#e0a23c", fontWeight: 700 }}>
              ◦ FLOOR {o.reason === "Hold" ? "HOLD — no trade" : `SKIP (${o.reason}) — vetoed`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
