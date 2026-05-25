import { neon } from "@neondatabase/serverless";
import {
  createEmptyMonitorStatus,
  mergeMonitorPatch,
  summarizeMonitorStatus,
  type MonitorError,
  type MonitorLeaseStatus,
  type MonitorStatus,
  type MonitorStatusPatch,
  type MonitorStatusSummary,
} from "./monitor-status";

const MONITOR_ROW_ID = "copy-engine";
let monitorWriteQueue: Promise<unknown> = Promise.resolve();

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

export interface MonitorSnapshot {
  status: MonitorStatus;
  summary: MonitorStatusSummary;
  updatedAt: string | null;
}

export async function ensureMonitorStatusTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS ops_monitor_status (
      id         text PRIMARY KEY,
      payload    jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function readStoredMonitorStatus(): Promise<{
  status: MonitorStatus;
  updatedAt: string | null;
}> {
  await ensureMonitorStatusTable();
  const sql = client();
  const rows = (await sql`
    SELECT payload, updated_at
    FROM ops_monitor_status
    WHERE id = ${MONITOR_ROW_ID}
    LIMIT 1
  `) as Array<{ payload: MonitorStatus; updated_at: Date | string }>;
  const row = rows[0];
  if (!row) {
    return { status: createEmptyMonitorStatus(), updatedAt: null };
  }
  return {
    status: mergeMonitorPatch(row.payload, {}),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}

async function writeMonitorStatus(status: MonitorStatus): Promise<void> {
  const sql = client();
  await sql`
    INSERT INTO ops_monitor_status (id, payload, updated_at)
    VALUES (${MONITOR_ROW_ID}, ${JSON.stringify(status)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = now()
  `;
}

async function applyMonitorStatusPatch(
  patch: MonitorStatusPatch,
): Promise<MonitorStatus> {
  const current = await readStoredMonitorStatus();
  const next = mergeMonitorPatch(current.status, patch);
  await writeMonitorStatus(next);
  return next;
}

export async function patchMonitorStatus(
  patch: MonitorStatusPatch,
): Promise<MonitorStatus> {
  const run = () => applyMonitorStatusPatch(patch);
  const next = monitorWriteQueue.then(run, run);
  monitorWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function recordMonitorError(args: {
  component: string;
  message: string;
  at?: Date;
}): Promise<void> {
  const error: MonitorError = {
    component: args.component,
    message: args.message.slice(0, 500),
    at: (args.at ?? new Date()).toISOString(),
  };
  await patchMonitorStatus({ recentErrors: [error] });
}

async function readLease(
  table: "whale_ticker_lease" | "ticker_lease",
): Promise<MonitorLeaseStatus | null> {
  const sql = client();
  try {
    const rows =
      table === "whale_ticker_lease"
        ? ((await sql`
            SELECT holder, heartbeat_at
            FROM whale_ticker_lease
            WHERE id = 1
            LIMIT 1
          `) as Array<{ holder: string; heartbeat_at: Date | string }>)
        : ((await sql`
            SELECT holder, heartbeat_at
            FROM ticker_lease
            WHERE id = 1
            LIMIT 1
          `) as Array<{ holder: string; heartbeat_at: Date | string }>);
    const row = rows[0];
    if (!row) return null;
    const heartbeat =
      row.heartbeat_at instanceof Date
        ? row.heartbeat_at
        : new Date(row.heartbeat_at);
    return {
      holder: row.holder,
      heartbeatAt: heartbeat.toISOString(),
      ageMs: Date.now() - heartbeat.getTime(),
    };
  } catch (err) {
    if (String(err).includes("does not exist")) return null;
    throw err;
  }
}

export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
  const [{ status, updatedAt }, whaleTicker, botTicker] = await Promise.all([
    readStoredMonitorStatus(),
    readLease("whale_ticker_lease").catch(async (err) => {
      await recordMonitorError({
        component: "monitor-api",
        message: `whale lease read failed: ${String(err)}`,
      }).catch(() => undefined);
      return null;
    }),
    readLease("ticker_lease").catch(async (err) => {
      await recordMonitorError({
        component: "monitor-api",
        message: `bot lease read failed: ${String(err)}`,
      }).catch(() => undefined);
      return null;
    }),
  ]);
  const withLeases = mergeMonitorPatch(status, {
    leases: { whaleTicker, botTicker },
  });
  return {
    status: withLeases,
    summary: summarizeMonitorStatus(withLeases),
    updatedAt,
  };
}
