import { describe, expect, it } from "vitest";

import {
  createEmptyMonitorStatus,
  mergeMonitorPatch,
  summarizeMonitorStatus,
} from "./monitor-status";

describe("monitor status merging", () => {
  it("upserts websocket socket status by name", () => {
    const status = createEmptyMonitorStatus();

    const next = mergeMonitorPatch(status, {
      websockets: {
        sockets: [
          {
            name: "hyperliquid:1",
            source: "hyperliquid",
            connected: true,
            accounts: 20,
            updatedAt: "2026-05-26T10:00:00.000Z",
          },
        ],
      },
    });

    const updated = mergeMonitorPatch(next, {
      websockets: {
        sockets: [
          {
            name: "hyperliquid:1",
            source: "hyperliquid",
            connected: false,
            accounts: 20,
            lastError: "closed",
            updatedAt: "2026-05-26T10:01:00.000Z",
          },
        ],
      },
    });

    expect(updated.websockets.sockets).toEqual([
      {
        name: "hyperliquid:1",
        source: "hyperliquid",
        connected: false,
        accounts: 20,
        lastError: "closed",
        updatedAt: "2026-05-26T10:01:00.000Z",
      },
    ]);
  });

  it("keeps recent monitor errors newest first and bounded", () => {
    let status = createEmptyMonitorStatus();
    for (let i = 0; i < 12; i += 1) {
      status = mergeMonitorPatch(status, {
        recentErrors: [
          {
            component: "source-monitor",
            message: `error-${i}`,
            at: `2026-05-26T10:${String(i).padStart(2, "0")}:00.000Z`,
          },
        ],
      });
    }

    expect(status.recentErrors).toHaveLength(10);
    expect(status.recentErrors[0]?.message).toBe("error-11");
    expect(status.recentErrors.at(-1)?.message).toBe("error-2");
  });

  it("summarizes websocket and sweep health", () => {
    const status = mergeMonitorPatch(createEmptyMonitorStatus(), {
      websockets: {
        sockets: [
          {
            name: "hyperliquid:1",
            source: "hyperliquid",
            connected: true,
            accounts: 20,
            updatedAt: "2026-05-26T10:00:00.000Z",
          },
          {
            name: "hyperliquid:2",
            source: "hyperliquid",
            connected: false,
            accounts: 20,
            updatedAt: "2026-05-26T10:00:00.000Z",
          },
        ],
        lastSourceEventAt: "2026-05-26T10:00:05.000Z",
      },
      autoClose: {
        lastSweepAt: "2026-05-26T10:00:08.000Z",
        lastResult: {
          reason: "hyperliquid userFills",
          forceSourceFetch: true,
          scannedLeaders: 2,
          closesAttempted: 1,
          closesSucceeded: 1,
          errors: [],
        },
      },
    });

    expect(summarizeMonitorStatus(status)).toEqual({
      connectedSockets: 1,
      totalSockets: 2,
      websocketHealthy: false,
      lastSourceEventAt: "2026-05-26T10:00:05.000Z",
      lastAutoCloseSweepAt: "2026-05-26T10:00:08.000Z",
      lastAutoCloseHadErrors: false,
      recentErrorCount: 0,
    });
  });
});
