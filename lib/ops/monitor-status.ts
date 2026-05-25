export interface MonitorSocketStatus {
  name: string;
  source: "hyperliquid" | "pacifica";
  connected: boolean;
  accounts: number;
  connectedAt?: string;
  disconnectedAt?: string;
  lastEventAt?: string;
  lastError?: string;
  reconnects?: number;
  updatedAt: string;
}

export interface MonitorError {
  component: string;
  message: string;
  at: string;
}

export interface MonitorLeaseStatus {
  holder: string | null;
  heartbeatAt: string | null;
  ageMs: number | null;
}

export interface AutoCloseSweepStatus {
  reason: string;
  forceSourceFetch: boolean;
  scannedLeaders: number;
  closesAttempted: number;
  closesSucceeded: number;
  errors: Array<{ betId: string; message: string }>;
}

export interface MonitorStatus {
  websockets: {
    sockets: MonitorSocketStatus[];
    lastSourceEventAt: string | null;
    lastSourceEventReason: string | null;
  };
  autoClose: {
    lastSweepAt: string | null;
    lastResult: AutoCloseSweepStatus | null;
  };
  leases: {
    whaleTicker: MonitorLeaseStatus | null;
    botTicker: MonitorLeaseStatus | null;
  };
  recentErrors: MonitorError[];
}

export type MonitorStatusPatch = Partial<{
  websockets: Partial<MonitorStatus["websockets"]>;
  autoClose: Partial<MonitorStatus["autoClose"]>;
  leases: Partial<MonitorStatus["leases"]>;
  recentErrors: MonitorError[];
}>;

export interface MonitorStatusSummary {
  connectedSockets: number;
  totalSockets: number;
  websocketHealthy: boolean;
  lastSourceEventAt: string | null;
  lastAutoCloseSweepAt: string | null;
  lastAutoCloseHadErrors: boolean;
  recentErrorCount: number;
}

const MAX_RECENT_ERRORS = 10;

export function createEmptyMonitorStatus(): MonitorStatus {
  return {
    websockets: {
      sockets: [],
      lastSourceEventAt: null,
      lastSourceEventReason: null,
    },
    autoClose: {
      lastSweepAt: null,
      lastResult: null,
    },
    leases: {
      whaleTicker: null,
      botTicker: null,
    },
    recentErrors: [],
  };
}

function mergeSockets(
  current: MonitorSocketStatus[],
  patch: MonitorSocketStatus[] | undefined,
): MonitorSocketStatus[] {
  if (!patch || patch.length === 0) return current;
  const byName = new Map(current.map((socket) => [socket.name, socket]));
  for (const socket of patch) {
    byName.set(socket.name, {
      ...(byName.get(socket.name) ?? {}),
      ...socket,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeMonitorPatch(
  current: MonitorStatus | null | undefined,
  patch: MonitorStatusPatch,
): MonitorStatus {
  const base = current ?? createEmptyMonitorStatus();
  return {
    websockets: {
      ...base.websockets,
      ...patch.websockets,
      sockets: mergeSockets(base.websockets.sockets, patch.websockets?.sockets),
    },
    autoClose: {
      ...base.autoClose,
      ...patch.autoClose,
    },
    leases: {
      ...base.leases,
      ...patch.leases,
    },
    recentErrors: [
      ...(patch.recentErrors ?? []),
      ...base.recentErrors,
    ].slice(0, MAX_RECENT_ERRORS),
  };
}

export function summarizeMonitorStatus(
  status: MonitorStatus,
): MonitorStatusSummary {
  const totalSockets = status.websockets.sockets.length;
  const connectedSockets = status.websockets.sockets.filter(
    (socket) => socket.connected,
  ).length;
  return {
    connectedSockets,
    totalSockets,
    websocketHealthy: totalSockets > 0 && connectedSockets === totalSockets,
    lastSourceEventAt: status.websockets.lastSourceEventAt,
    lastAutoCloseSweepAt: status.autoClose.lastSweepAt,
    lastAutoCloseHadErrors:
      (status.autoClose.lastResult?.errors.length ?? 0) > 0,
    recentErrorCount: status.recentErrors.length,
  };
}
