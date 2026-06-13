"use client";

// AI Oracle Bots section of the arena roster. These bots' brains run OFF-CHAIN
// (Claude / Grok) and their decisions are scored by the on-chain safety floor —
// so unlike the deterministic "on-chain strategy" bots above, their card is fed
// by the brain API (/api/arena/llm), not the rollup. Clearly labeled as the
// "oracle bot" tier per the arena spec. Live LLM calls ⇒ ~several seconds.

import { useCallback, useEffect, useState } from "react";
import { BG, DIM, FAINT, FG, GREEN, Headline, STREAK } from "@/components/v2/ui";

const RED = "#f87272";

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
  | { kind: "send"; args: { leverage: number; stopBps: number; stakeFracBps: number } }
  | { kind: "skip"; reason: string };
type OracleBot = {
  persona: string;
  displayName: string;
  avatarEmoji: string;
  modelId: string;
  status: "ok" | "no-key" | "error";
  latencyMs?: number;
  decision?: Decision;
  outcome?: Outcome;
};

export function OracleBots() {
  const [bots, setBots] = useState<OracleBot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/arena/llm", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { bots: OracleBot[] };
      setBots(json.bots);
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
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: DIM }}>
            AI ORACLE BOTS
          </div>
          <div className="mt-0.5 text-[10px]" style={{ color: DIM }}>
            off-chain brain · on-chain rules
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest"
          style={{ color: loading ? DIM : STREAK, borderColor: `${STREAK}55`, background: `${STREAK}14` }}
        >
          {loading ? "thinking…" : "run a round"}
        </button>
      </div>

      {err && (
        <p className="text-[11px]" style={{ color: RED }}>
          {err}
        </p>
      )}

      <div className="flex flex-col gap-3 lg:grid lg:auto-rows-max lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
        {bots
          ? bots.map((b) => <OracleCard key={b.persona} bot={b} />)
          : loading && [0, 1].map((i) => <OracleSkeleton key={i} />)}
      </div>
    </div>
  );
}

function OracleCard({ bot }: { bot: OracleBot }) {
  const d = bot.decision;
  const o = bot.outcome;
  const actionColor = !d || d.action === "hold" ? DIM : d.side === "long" ? GREEN : RED;
  const actionText = d
    ? d.action === "hold"
      ? "HOLD"
      : `${d.action.toUpperCase()} ${d.side.toUpperCase()} ${d.asset}`
    : "—";

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: FAINT, background: BG }}>
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none">{bot.avatarEmoji}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Headline size={16}>{bot.displayName}</Headline>
            <span
              className="rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest"
              style={{ color: STREAK, borderColor: `${STREAK}55`, background: `${STREAK}14` }}
            >
              oracle bot
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>
            {bot.modelId}
            {bot.latencyMs ? ` · ${(bot.latencyMs / 1000).toFixed(1)}s` : ""}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: actionColor }}>
            {actionText}
          </div>
          {d?.action === "open" && (
            <div className="text-[10px] tabular-nums" style={{ color: DIM }}>
              {d.leverage}x · {(d.stakeFracPct * 100).toFixed(0)}% · stop {(d.stopLossPct * 100).toFixed(1)}%
            </div>
          )}
          {d && (
            <div className="text-[9px] uppercase tracking-widest" style={{ color: DIM }}>
              conf {d.confidence.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {bot.status === "no-key" && (
        <p className="mt-3 text-[11px]" style={{ color: STREAK }}>
          No API key — set {bot.persona.includes("grok") ? "XAI_API_KEY" : "ANTHROPIC_API_KEY"} in .env.local
        </p>
      )}
      {bot.status === "error" && (
        <p className="mt-3 text-[11px]" style={{ color: RED }}>
          model error
        </p>
      )}

      {d && (
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: FG }}>
          “{d.reasoning}”
        </p>
      )}

      {o && (
        <div className="mt-3 border-t pt-2.5 text-[11px] font-black uppercase tracking-wide" style={{ borderColor: FAINT }}>
          {o.kind === "send" ? (
            <span style={{ color: GREEN }}>
              ✓ floor pass → {o.args.leverage}x · stop {(o.args.stopBps / 100).toFixed(1)}% · {(o.args.stakeFracBps / 100).toFixed(0)}% stake
            </span>
          ) : (
            <span style={{ color: o.reason === "Hold" ? DIM : STREAK }}>
              ◦ floor {o.reason === "Hold" ? "hold — no trade" : `skip (${o.reason})`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function OracleSkeleton() {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: FAINT, background: BG }}>
      <div className="skeleton-block h-5 w-28 rounded-md" />
      <div className="skeleton-block mt-3 h-3 w-full rounded-md" />
      <div className="skeleton-block mt-2 h-3 w-2/3 rounded-md" />
    </div>
  );
}
