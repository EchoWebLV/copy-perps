import { CURATED_WHALES } from "@/lib/hyperliquid/whales";
import type { MirrorCloseSweepOptions } from "@/lib/bets/mirror-close";
import {
  patchMonitorStatus,
  recordMonitorError,
} from "@/lib/ops/monitor-store";
import type { MonitorSocketStatus } from "@/lib/ops/monitor-status";
import { CURATED_PACIFICA_WHALES } from "./curated";

const HYPERLIQUID_WS_URL =
  process.env.HYPERLIQUID_WS_URL ?? "wss://api.hyperliquid.xyz/ws";
const PACIFICA_WS_URL =
  process.env.PACIFICA_WS_URL ?? "wss://ws.pacifica.fi/ws";
const RECONCILE_DELAY_MS = Number(
  process.env.WHALE_SOURCE_RECONCILE_DELAY_MS ?? 750,
);
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SOURCE_ACCOUNTS_PER_SOCKET = Number(
  process.env.WHALE_SOURCE_ACCOUNTS_PER_SOCKET ?? 20,
);
const PACIFICA_HEARTBEAT_MS = 45_000;

type JsonRecord = Record<string, unknown>;
type ReconcileArgs = MirrorCloseSweepOptions & { reason: string };
type ReconcileFn = (args: ReconcileArgs) => Promise<void>;
type TriggerFn = (reason: string) => void;

export interface SourceMonitorHandle {
  stop: () => void;
}

type WebSocketCtor = new (url: string) => WebSocket;

function writeMonitorPatchBestEffort(
  patch: Parameters<typeof patchMonitorStatus>[0],
): void {
  void patchMonitorStatus(patch).catch((err) => {
    console.warn("[whale-source-ws] monitor status write failed:", err);
  });
}

function recordMonitorErrorBestEffort(component: string, message: string): void {
  void recordMonitorError({ component, message }).catch((err) => {
    console.warn("[whale-source-ws] monitor error write failed:", err);
  });
}

export function hyperliquidUserFillsSubscription(user: string): JsonRecord {
  return {
    method: "subscribe",
    subscription: {
      type: "userFills",
      user,
    },
  };
}

export function pacificaAccountPositionsSubscription(account: string): JsonRecord {
  return {
    method: "subscribe",
    params: {
      source: "account_positions",
      account,
    },
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHyperliquidPositionEvent(message: unknown): boolean {
  if (!isRecord(message) || message.channel !== "userFills") return false;
  const data = message.data;
  if (!isRecord(data) || data.isSnapshot === true) return false;
  return Array.isArray(data.fills) && data.fills.length > 0;
}

export function isPacificaPositionEvent(message: unknown): boolean {
  if (!isRecord(message) || message.channel !== "account_positions") {
    return false;
  }
  return Array.isArray(message.data);
}

export function makeDebouncedSourceTrigger(args: {
  delayMs?: number;
  reconcile: ReconcileFn;
}): TriggerFn {
  const delayMs = args.delayMs ?? RECONCILE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestReason = "source update";
  let running = false;
  let runAgain = false;

  const fire = () => {
    timer = null;
    if (running) {
      runAgain = true;
      return;
    }
    running = true;
    const reason = latestReason;
    void args
      .reconcile({ forceSourceFetch: true, reason })
      .catch((err) => {
        console.error("[whale-source-ws] forced reconciliation failed:", err);
      })
      .finally(() => {
        running = false;
        if (runAgain) {
          runAgain = false;
          fire();
        }
      });
  };

  return (reason: string) => {
    latestReason = reason;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delayMs);
  };
}

function parseJsonMessage(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(value));
}

function uniqueAccounts(accounts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const account of accounts) {
    const trimmed = account.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

function managedSocket(args: {
  name: string;
  source: MonitorSocketStatus["source"];
  url: string;
  accounts: number;
  websocketCtor: WebSocketCtor;
  onOpen: (socket: WebSocket) => void;
  onMessage: (message: unknown) => void;
  heartbeat?: (socket: WebSocket) => void;
}): SourceMonitorHandle {
  let stopped = false;
  let attempts = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    reconnectTimer = null;
    heartbeatTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delayMs = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_MIN_MS * Math.pow(2, attempts),
    );
    attempts += 1;
    reconnectTimer = setTimeout(connect, delayMs);
  };

  const connect = () => {
    if (stopped) return;
    clearTimers();
    try {
      socket = new args.websocketCtor(args.url);
    } catch (err) {
      console.error(`[whale-source-ws] ${args.name} connect failed:`, err);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      attempts = 0;
      console.log(`[whale-source-ws] ${args.name} connected`);
      writeMonitorPatchBestEffort({
        websockets: {
          sockets: [
            {
              name: args.name,
              source: args.source,
              connected: true,
              accounts: args.accounts,
              connectedAt: new Date().toISOString(),
              reconnects: attempts,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      });
      args.onOpen(socket!);
      if (args.heartbeat) {
        heartbeatTimer = setInterval(() => {
          if (socket) args.heartbeat?.(socket);
        }, PACIFICA_HEARTBEAT_MS);
      }
    };
    socket.onmessage = (event) => {
      args.onMessage(parseJsonMessage(event.data));
    };
    socket.onerror = (event) => {
      console.warn(`[whale-source-ws] ${args.name} error:`, event);
      recordMonitorErrorBestEffort(
        "source-websocket",
        `${args.name} websocket error`,
      );
      writeMonitorPatchBestEffort({
        websockets: {
          sockets: [
            {
              name: args.name,
              source: args.source,
              connected: socket?.readyState === 1,
              accounts: args.accounts,
              lastError: "websocket error",
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      });
    };
    socket.onclose = () => {
      clearTimers();
      socket = null;
      const at = new Date().toISOString();
      writeMonitorPatchBestEffort({
        websockets: {
          sockets: [
            {
              name: args.name,
              source: args.source,
              connected: false,
              accounts: args.accounts,
              disconnectedAt: at,
              reconnects: attempts,
              updatedAt: at,
            },
          ],
        },
      });
      if (!stopped) {
        console.warn(`[whale-source-ws] ${args.name} closed, reconnecting`);
        scheduleReconnect();
      }
    };
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      clearTimers();
      socket?.close();
      socket = null;
    },
  };
}

async function defaultReconcile(args: ReconcileArgs): Promise<void> {
  const [{ runMirrorCloseSweep }, { refreshWhales }] = await Promise.all([
    import("@/lib/bets/mirror-close"),
    import("./refresh"),
  ]);
  const [sweep, refresh] = await Promise.allSettled([
    runMirrorCloseSweep({
      forceSourceFetch: args.forceSourceFetch,
      reason: args.reason,
    }),
    refreshWhales(),
  ]);

  if (sweep.status === "fulfilled") {
    const r = sweep.value;
    if (r.closesAttempted > 0 || r.errors.length > 0) {
      console.log(
        `[whale-source-ws] ${r.closesSucceeded}/${r.closesAttempted} ` +
          `tails auto-closed after ${args.reason}, ${r.errors.length} error(s)`,
      );
    }
  } else {
    console.error("[whale-source-ws] close sweep failed:", sweep.reason);
    await recordMonitorError({
      component: "source-reconcile",
      message: `close sweep failed: ${String(sweep.reason)}`,
    }).catch(() => undefined);
  }

  if (refresh.status === "rejected") {
    console.warn("[whale-source-ws] refresh after source event failed:", refresh.reason);
    await recordMonitorError({
      component: "source-reconcile",
      message: `refresh failed: ${String(refresh.reason)}`,
    }).catch(() => undefined);
  }
}

export function startWhaleSourceMonitor(args: {
  websocketCtor?: WebSocketCtor;
  hyperliquidAccounts?: string[];
  pacificaAccounts?: string[];
  trigger?: TriggerFn;
} = {}): SourceMonitorHandle {
  if (process.env.DISABLE_WHALE_SOURCE_MONITOR === "true") {
    return { stop: () => undefined };
  }

  const websocketCtor = args.websocketCtor ?? globalThis.WebSocket;
  if (!websocketCtor) {
    console.warn("[whale-source-ws] WebSocket is unavailable in this runtime");
    return { stop: () => undefined };
  }

  const trigger =
    args.trigger ??
    makeDebouncedSourceTrigger({
      reconcile: defaultReconcile,
    });
  const handles: SourceMonitorHandle[] = [];

  const hyperliquidAccounts = uniqueAccounts(
    args.hyperliquidAccounts ??
      CURATED_WHALES.map((whale) => whale.address.toLowerCase()),
  );
  for (const [index, accounts] of chunk(
    hyperliquidAccounts,
    SOURCE_ACCOUNTS_PER_SOCKET,
  ).entries()) {
    handles.push(
      managedSocket({
        name: `hyperliquid:${index + 1}`,
        source: "hyperliquid",
        url: HYPERLIQUID_WS_URL,
        accounts: accounts.length,
        websocketCtor,
        onOpen: (socket) => {
          for (const account of accounts) {
            sendJson(socket, hyperliquidUserFillsSubscription(account));
          }
        },
        onMessage: (message) => {
          if (isHyperliquidPositionEvent(message)) {
            const at = new Date().toISOString();
            writeMonitorPatchBestEffort({
              websockets: {
                lastSourceEventAt: at,
                lastSourceEventReason: "hyperliquid userFills",
                sockets: [
                  {
                    name: `hyperliquid:${index + 1}`,
                    source: "hyperliquid",
                    connected: true,
                    accounts: accounts.length,
                    lastEventAt: at,
                    updatedAt: at,
                  },
                ],
              },
            });
            trigger(`hyperliquid userFills`);
          }
        },
      }),
    );
  }

  const pacificaAccounts = uniqueAccounts(
    args.pacificaAccounts ??
      CURATED_PACIFICA_WHALES.map((whale) => whale.sourceAccount),
  );
  for (const [index, accounts] of chunk(
    pacificaAccounts,
    SOURCE_ACCOUNTS_PER_SOCKET,
  ).entries()) {
    handles.push(
      managedSocket({
        name: `pacifica:${index + 1}`,
        source: "pacifica",
        url: PACIFICA_WS_URL,
        accounts: accounts.length,
        websocketCtor,
        onOpen: (socket) => {
          for (const account of accounts) {
            sendJson(socket, pacificaAccountPositionsSubscription(account));
          }
        },
        onMessage: (message) => {
          if (isPacificaPositionEvent(message)) {
            const at = new Date().toISOString();
            writeMonitorPatchBestEffort({
              websockets: {
                lastSourceEventAt: at,
                lastSourceEventReason: "pacifica account_positions",
                sockets: [
                  {
                    name: `pacifica:${index + 1}`,
                    source: "pacifica",
                    connected: true,
                    accounts: accounts.length,
                    lastEventAt: at,
                    updatedAt: at,
                  },
                ],
              },
            });
            trigger(`pacifica account_positions`);
          }
        },
        heartbeat: (socket) => {
          sendJson(socket, { method: "ping" });
        },
      }),
    );
  }

  if (handles.length === 0) {
    console.log("[whale-source-ws] no source accounts to monitor");
  } else {
    console.log(`[whale-source-ws] monitoring ${handles.length} socket(s)`);
  }

  return {
    stop: () => {
      for (const handle of handles) handle.stop();
    },
  };
}
