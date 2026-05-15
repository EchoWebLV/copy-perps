import Link from "next/link";
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { sql, eq, desc } from "drizzle-orm";
import { getStrategyWiring } from "@/lib/bots/wiring";
import { syncDbBotsToRegistry } from "@/lib/admin/sync";
import { avatarImageForBot } from "@/lib/bots/avatars";

interface BotRow {
  id: string;
  name: string;
  avatarEmoji: string;
  strategyKey: string;
  status: string;
  parentId: string | null;
  balanceUsd: number;
  startingBalanceUsd: number;
  openCount: number;
  closedCount: number;
  realizedPnl: number;
  lastEntryTs: Date | null;
}

async function loadBots(): Promise<BotRow[]> {
  // Aggregate paper-position stats per bot.
  const rows = await db
    .select({
      id: bots.id,
      name: bots.name,
      avatarEmoji: bots.avatarEmoji,
      strategyKey: bots.strategyKey,
      status: bots.status,
      parentId: bots.parentId,
      balanceUsd: bots.balanceUsd,
      startingBalanceUsd: bots.startingBalanceUsd,
      openCount: sql<number>`COALESCE(SUM(CASE WHEN ${paperPositions.status} = 'open' THEN 1 ELSE 0 END), 0)::int`,
      closedCount: sql<number>`COALESCE(SUM(CASE WHEN ${paperPositions.status} = 'closed' THEN 1 ELSE 0 END), 0)::int`,
      realizedPnl: sql<number>`COALESCE(SUM(${paperPositions.paperPnlUsd}), 0)::float`,
      lastEntryTs: sql<Date | null>`MAX(${paperPositions.entryTs})`,
    })
    .from(bots)
    .leftJoin(paperPositions, eq(paperPositions.botId, bots.id))
    .groupBy(bots.id)
    .orderBy(desc(bots.balanceUsd), bots.id);
  return rows as BotRow[];
}

function fmtUsd(n: number): string {
  if (Math.abs(n) < 0.01) return "$0.00";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function fmtAge(ts: Date | null): string {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const dynamic = "force-dynamic";

export default async function AdminBotsPage() {
  // Re-register any DB bot rows the static registry doesn't know about
  // (i.e. admin-cloned variants from a previous session).
  await syncDbBotsToRegistry();
  const list = await loadBots();

  const liveCount = list.filter((b) => b.status === "paper").length;
  const totalBalance = list.reduce((s, b) => s + b.balanceUsd, 0);
  const totalStart = list.reduce((s, b) => s + b.startingBalanceUsd, 0);
  const aggregateReturn = totalStart > 0 ? (totalBalance - totalStart) / totalStart : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All bots</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {list.length} bots registered · {liveCount} paper-active · aggregate{" "}
            <span
              className={
                aggregateReturn > 0
                  ? "text-emerald-400"
                  : aggregateReturn < 0
                    ? "text-red-400"
                    : "text-zinc-400"
              }
            >
              {fmtPct(aggregateReturn)}
            </span>
          </p>
        </div>
        <Link
          href="/admin/bots/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Clone variant
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Bot</th>
              <th className="px-4 py-3 text-left font-medium">Strategy</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
              <th className="px-4 py-3 text-right font-medium">Return</th>
              <th className="px-4 py-3 text-right font-medium">Open</th>
              <th className="px-4 py-3 text-right font-medium">Closed</th>
              <th className="px-4 py-3 text-right font-medium">Last entry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {list.map((b) => {
              const wiring = getStrategyWiring(b.strategyKey);
              const ret =
                b.startingBalanceUsd > 0
                  ? (b.balanceUsd - b.startingBalanceUsd) / b.startingBalanceUsd
                  : 0;
              return (
                <tr
                  key={b.id}
                  className="cursor-pointer transition hover:bg-zinc-900/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bots/${b.id}`}
                      className="flex items-center gap-3"
                    >
                      {avatarImageForBot(b.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarImageForBot(b.id) as string}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-zinc-800"
                          draggable={false}
                        />
                      ) : (
                        <span className="text-2xl leading-none">
                          {b.avatarEmoji}
                        </span>
                      )}
                      <div>
                        <div className="font-medium text-white">{b.name}</div>
                        <div className="font-mono text-xs text-zinc-500">
                          {b.id}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    <div>{wiring?.displayName ?? b.strategyKey}</div>
                    {b.parentId && (
                      <div className="text-xs text-zinc-500">
                        variant of {b.parentId}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    ${b.balanceUsd.toFixed(2)}
                    <div className="text-xs text-zinc-500">
                      from ${b.startingBalanceUsd.toFixed(0)}
                    </div>
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      ret > 0
                        ? "text-emerald-400"
                        : ret < 0
                          ? "text-red-400"
                          : "text-zinc-400"
                    }`}
                  >
                    {fmtPct(ret)}
                    <div className="text-xs text-zinc-500">
                      {fmtUsd(b.realizedPnl)} realized
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {b.openCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {b.closedCount}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">
                    {fmtAge(b.lastEntryTs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paper: "bg-blue-900/40 text-blue-300 border-blue-800",
    live: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
    "backtest-fail": "bg-red-900/40 text-red-300 border-red-800",
    retired: "bg-zinc-800 text-zinc-400 border-zinc-700",
    busted: "bg-red-900/60 text-red-200 border-red-800",
  };
  const cls =
    map[status] ?? "bg-zinc-800 text-zinc-300 border-zinc-700";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {status}
    </span>
  );
}
