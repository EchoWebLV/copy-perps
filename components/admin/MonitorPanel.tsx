"use client";

import { useEffect, useMemo, useState } from "react";
import type { MonitorSnapshot } from "@/lib/ops/monitor-store";
import type { MonitorLeaseStatus } from "@/lib/ops/monitor-status";

function timeLabel(
  value: string | null | undefined,
  nowMs: number | null,
): string {
  if (!value) return "never";
  if (nowMs === null) return "...";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "unknown";
  const deltaMs = nowMs - ts;
  if (deltaMs < 5_000) return "just now";
  const seconds = Math.floor(deltaMs / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ageMsLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value < 1_000) return `${Math.max(0, Math.round(value))}ms`;
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function shortHolder(holder: string | null | undefined): string {
  if (!holder) return "none";
  if (holder.length <= 34) return holder;
  return `${holder.slice(0, 18)}...${holder.slice(-10)}`;
}

function StatusPill({
  tone,
  label,
}: {
  tone: "good" | "bad" | "warn" | "muted";
  label: string;
}) {
  const cls = {
    good: "border-emerald-800 bg-emerald-950 text-emerald-300",
    bad: "border-red-800 bg-red-950 text-red-300",
    warn: "border-amber-800 bg-amber-950 text-amber-300",
    muted: "border-zinc-800 bg-zinc-900 text-zinc-400",
  }[tone];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "muted",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "bad" | "warn" | "muted";
}) {
  const valueCls = {
    good: "text-emerald-300",
    bad: "text-red-300",
    warn: "text-amber-300",
    muted: "text-white",
  }[tone];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${valueCls}`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{detail}</div>
    </div>
  );
}

function LeaseBlock({
  title,
  lease,
  nowMs,
}: {
  title: string;
  lease: MonitorLeaseStatus | null;
  nowMs: number | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-white">{title}</div>
        <StatusPill
          tone={lease?.holder ? "good" : "warn"}
          label={lease?.holder ? "owned" : "empty"}
        />
      </div>
      <div className="mt-3 font-mono text-xs text-zinc-300">
        {shortHolder(lease?.holder)}
      </div>
      <div className="mt-2 text-xs text-zinc-500">
        heartbeat {timeLabel(lease?.heartbeatAt, nowMs)} - age{" "}
        {ageMsLabel(lease?.ageMs)}
      </div>
    </div>
  );
}

export function MonitorPanel({ initial }: { initial: MonitorSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [loadedAtIso, setLoadedAtIso] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setNowMs(Date.now());
    setLoadedAtIso(new Date().toISOString());
    const clockTimer = setInterval(() => setNowMs(Date.now()), 1_000);
    async function load() {
      try {
        const resp = await fetch("/api/admin/monitor", { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const next = (await resp.json()) as MonitorSnapshot;
        if (!alive) return;
        setSnapshot(next);
        setLoadedAtIso(new Date().toISOString());
        setLoadError(null);
      } catch (err) {
        if (alive) setLoadError(String(err));
      }
    }
    const timer = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, []);

  const sockets = snapshot.status.websockets.sockets;
  const summary = snapshot.summary;
  const lastSweep = snapshot.status.autoClose.lastResult;
  const websocketTone = summary.websocketHealthy
    ? "good"
    : summary.totalSockets > 0
      ? "warn"
      : "muted";
  const sweepTone = summary.lastAutoCloseHadErrors ? "bad" : "good";
  const sourceBreakdown = useMemo(() => {
    const bySource = new Map<string, { connected: number; total: number }>();
    for (const socket of sockets) {
      const row = bySource.get(socket.source) ?? { connected: 0, total: 0 };
      row.total += 1;
      if (socket.connected) row.connected += 1;
      bySource.set(socket.source, row);
    }
    return [...bySource.entries()]
      .map(([source, row]) => `${source} ${row.connected}/${row.total}`)
      .join(" - ");
  }, [sockets]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Copy engine monitor
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Refreshed{" "}
            {loadedAtIso ? timeLabel(loadedAtIso, nowMs) : "loading"}
            {snapshot.updatedAt
              ? ` - stored ${timeLabel(snapshot.updatedAt, nowMs)}`
              : ""}
          </p>
        </div>
        {loadError ? (
          <StatusPill tone="bad" label={`refresh failed: ${loadError}`} />
        ) : (
          <StatusPill tone="good" label="refreshing" />
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric
          label="WebSockets"
          value={`${summary.connectedSockets}/${summary.totalSockets}`}
          detail={sourceBreakdown || "no sockets registered"}
          tone={websocketTone}
        />
        <Metric
          label="Last source event"
          value={timeLabel(summary.lastSourceEventAt, nowMs)}
          detail={snapshot.status.websockets.lastSourceEventReason ?? "no event"}
          tone={summary.lastSourceEventAt ? "good" : "muted"}
        />
        <Metric
          label="Auto-close sweep"
          value={timeLabel(summary.lastAutoCloseSweepAt, nowMs)}
          detail={
            lastSweep
              ? `${lastSweep.closesSucceeded}/${lastSweep.closesAttempted} closed`
              : "no sweep recorded"
          }
          tone={summary.lastAutoCloseSweepAt ? sweepTone : "muted"}
        />
        <Metric
          label="Recent errors"
          value={`${summary.recentErrorCount}`}
          detail={
            summary.lastAutoCloseHadErrors ? "last sweep had errors" : "latest sweep clean"
          }
          tone={summary.recentErrorCount > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <LeaseBlock
          title="Whale ticker lease"
          lease={snapshot.status.leases.whaleTicker}
          nowMs={nowMs}
        />
        <LeaseBlock
          title="Bot ticker lease"
          lease={snapshot.status.leases.botTicker}
          nowMs={nowMs}
        />
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-white">Source sockets</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Socket</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Accounts</th>
                <th className="px-4 py-3 text-left font-medium">Last event</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
                <th className="px-4 py-3 text-left font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {sockets.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-zinc-500" colSpan={6}>
                    No WebSocket status has been reported yet.
                  </td>
                </tr>
              ) : (
                sockets.map((socket) => (
                  <tr key={socket.name}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{socket.name}</div>
                      <div className="text-xs text-zinc-500">{socket.source}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        tone={socket.connected ? "good" : "bad"}
                        label={socket.connected ? "connected" : "closed"}
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                      {socket.accounts}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {timeLabel(socket.lastEventAt, nowMs)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {timeLabel(socket.updatedAt, nowMs)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {socket.lastError ?? "none"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-sm font-medium text-white">Last auto-close</h2>
          {lastSweep ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">
                  Reason
                </dt>
                <dd className="mt-1 text-zinc-200">{lastSweep.reason}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">
                  Force fetch
                </dt>
                <dd className="mt-1 text-zinc-200">
                  {lastSweep.forceSourceFetch ? "yes" : "no"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">
                  Leaders scanned
                </dt>
                <dd className="mt-1 text-zinc-200">
                  {lastSweep.scannedLeaders}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">
                  Closed
                </dt>
                <dd className="mt-1 text-zinc-200">
                  {lastSweep.closesSucceeded}/{lastSweep.closesAttempted}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No sweep recorded yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-sm font-medium text-white">Recent errors</h2>
          <div className="mt-4 space-y-3">
            {snapshot.status.recentErrors.length === 0 ? (
              <p className="text-sm text-zinc-500">No recent errors.</p>
            ) : (
              snapshot.status.recentErrors.map((error) => (
                <div
                  key={`${error.at}:${error.component}:${error.message}`}
                  className="border-l border-red-800 pl-3"
                >
                  <div className="text-xs uppercase tracking-wider text-red-300">
                    {error.component}
                  </div>
                  <div className="mt-1 text-sm text-zinc-200">
                    {error.message}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {timeLabel(error.at, nowMs)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
