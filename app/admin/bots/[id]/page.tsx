import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getStrategyWiring } from "@/lib/bots/wiring";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";
import { BotEditForm, type BotEditValues } from "@/components/admin/BotEditForm";

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ id: string }>;
}

interface PositionRow {
  id: string;
  asset: string;
  side: string;
  leverage: number;
  stakeUsd: number;
  entryMark: number;
  entryTs: Date;
  exitMark: number | null;
  exitTs: Date | null;
  paperPnlUsd: number | null;
  status: string;
}

async function loadDetail(id: string) {
  const [row] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  if (!row) return null;
  const open = (await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.botId, id), eq(paperPositions.status, "open")))
    .orderBy(desc(paperPositions.entryTs))) as PositionRow[];
  const closed = (await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, id), eq(paperPositions.status, "closed")),
    )
    .orderBy(desc(paperPositions.entryTs))
    .limit(20)) as PositionRow[];
  return { bot: row, open, closed };
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01) return "$0.00";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

function fmtTs(ts: Date | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RESOLVER_CONSTANTS = [
  {
    name: "MAX_CONCURRENT_POSITIONS",
    value: "4",
    purpose:
      "Cap on simultaneous open positions per bot. Beyond this the resolver skips entries.",
  },
  {
    name: "MAX_STAKE_PCT",
    value: "0.5 (50%)",
    purpose:
      "Maximum fraction of balance the resolver will stake on a single new position, scaled further by conviction.",
  },
  {
    name: "MIN_STAKE_USD",
    value: "$10",
    purpose:
      "Don't open positions smaller than this — the per-position cost floor.",
  },
  {
    name: "BUST_THRESHOLD_USD",
    value: "$10",
    purpose:
      "Below this balance the bot is marked busted and stops trading.",
  },
  {
    name: "MAX_BOTS_SAME_SIDE",
    value: "3",
    purpose:
      "Pileup cap. A 4th bot trying to open the same side on the same asset is skipped, forcing diversification across the roster.",
  },
];

export default async function BotDetailPage({ params }: PageParams) {
  const { id } = await params;
  const data = await loadDetail(id);
  if (!data) notFound();

  const { bot, open, closed } = data;
  const wiring = getStrategyWiring(bot.strategyKey);
  const ret =
    bot.startingBalanceUsd > 0
      ? (bot.balanceUsd - bot.startingBalanceUsd) / bot.startingBalanceUsd
      : 0;
  const realized = closed.reduce(
    (s, p) => s + (p.paperPnlUsd ?? 0),
    0,
  );

  // Live marks for open-position unrealized P&L.
  const marks = await getMarksSnapshot();

  const initialEditValues: BotEditValues = {
    id: bot.id,
    name: bot.name,
    avatarEmoji: bot.avatarEmoji,
    status: bot.status,
    personaVoiceKey: bot.personaVoiceKey,
    config: (bot.config as Record<string, unknown>) ?? {},
    balanceUsd: bot.balanceUsd,
    startingBalanceUsd: bot.startingBalanceUsd,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none">{bot.avatarEmoji}</span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {bot.name}
              </h1>
              <StatusBadge status={bot.status} />
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              <span className="font-mono">{bot.id}</span>
              {bot.parentId && <span>· variant of {bot.parentId}</span>}
              <span>
                · joined {fmtTs(bot.createdAt as unknown as Date)}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums">
            ${bot.balanceUsd.toFixed(2)}
          </div>
          <div
            className={`text-sm ${
              ret > 0
                ? "text-emerald-400"
                : ret < 0
                  ? "text-red-400"
                  : "text-zinc-400"
            }`}
          >
            {fmtPct(ret)} return · from $
            {bot.startingBalanceUsd.toFixed(0)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Realized {fmtUsd(realized)} across {closed.length} closed
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Wiring" subtitle="What this bot reads and where it lives.">
          {wiring ? (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {wiring.displayName}
                </h4>
                <p className="mt-1 text-sm text-zinc-400">
                  {wiring.description}
                </p>
              </div>

              <FileRow label="Strategy" path={wiring.strategyFile} />
              <FileRow label="Persona" path={wiring.personaFile} />
              <FileRow label="Tests" path={wiring.testFile} />

              <div>
                <h5 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">
                  Data sources ({wiring.dataSources.length})
                </h5>
                <div className="space-y-2">
                  {wiring.dataSources.map((d) => (
                    <div
                      key={d.label}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-100">
                          {d.label}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {d.file}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">{d.purpose}</p>
                      {d.endpoint && (
                        <div className="mt-2 rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-emerald-300 overflow-x-auto">
                          {d.endpoint}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {d.refreshHint}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-300">
              No wiring metadata for strategy key{" "}
              <code className="font-mono">{bot.strategyKey}</code>. The
              resolver will skip this bot. Edit the bot to point at a known
              family.
            </div>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            title={`Open positions (${open.length})`}
            subtitle="Live unrealized P&L is mark − entry × leverage on the staked margin."
          >
            {open.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Idle — waiting for an entry signal.
              </p>
            ) : (
              <PositionTable rows={open} live marks={marks} />
            )}
          </Panel>

          <Panel
            title={`Last 20 closed`}
            subtitle="Most recent realized exits."
          >
            {closed.length === 0 ? (
              <p className="text-sm text-zinc-500">No closed positions yet.</p>
            ) : (
              <PositionTable rows={closed} />
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Edit"
        subtitle="Saving updates the DB row. The runtime registry re-instantiates the strategy with the new config on the next admin page load or cron tick."
      >
        <BotEditForm
          initial={initialEditValues}
          knobs={wiring?.configKnobs ?? []}
        />
        <div className="mt-6 flex flex-wrap gap-3 border-t border-zinc-800 pt-4">
          <Link
            href={`/admin/bots/new?parent=${encodeURIComponent(bot.id)}`}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            + Clone this bot
          </Link>
          <Link
            href="/admin/bots"
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ← All bots
          </Link>
        </div>
      </Panel>

      <Panel
        title="Resolver constants (read-only)"
        subtitle="Currently hardcoded in lib/bots/resolver.ts. Apply globally to every paper bot."
      >
        <table className="w-full text-sm">
          <tbody className="divide-y divide-zinc-800">
            {RESOLVER_CONSTANTS.map((c) => (
              <tr key={c.name}>
                <td className="py-2 pr-4 font-mono text-xs text-zinc-300">
                  {c.name}
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-emerald-300">
                  {c.value}
                </td>
                <td className="py-2 text-xs text-zinc-400">{c.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function FileRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-300">{path}</span>
    </div>
  );
}

function PositionTable({
  rows,
  live,
  marks,
}: {
  rows: PositionRow[];
  live?: boolean;
  marks?: Map<string, number>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="py-1 pr-3 text-left">Asset</th>
            <th className="py-1 pr-3 text-left">Side</th>
            <th className="py-1 pr-3 text-right">Lev</th>
            <th className="py-1 pr-3 text-right">Stake</th>
            <th className="py-1 pr-3 text-right">Entry</th>
            <th className="py-1 pr-3 text-right">{live ? "Mark" : "Exit"}</th>
            <th className="py-1 pr-3 text-right">P&L</th>
            <th className="py-1 text-right">{live ? "Opened" : "Closed"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((p) => {
            const ref = live ? (marks?.get(p.asset) ?? null) : p.exitMark;
            let pnlDisplay: React.ReactNode = "—";
            if (live) {
              if (ref != null) {
                const pct = computeLivePaperPnlPct({
                  side: p.side as "long" | "short",
                  leverage: p.leverage,
                  entryMark: p.entryMark,
                  currentMark: ref,
                });
                const usd = pct * p.stakeUsd;
                pnlDisplay = (
                  <span
                    className={
                      usd > 0
                        ? "text-emerald-400"
                        : usd < 0
                          ? "text-red-400"
                          : "text-zinc-400"
                    }
                  >
                    {fmtUsd(usd)}{" "}
                    <span className="text-zinc-500">
                      ({(pct * 100).toFixed(1)}%)
                    </span>
                  </span>
                );
              }
            } else if (p.paperPnlUsd != null) {
              pnlDisplay = (
                <span
                  className={
                    p.paperPnlUsd > 0
                      ? "text-emerald-400"
                      : p.paperPnlUsd < 0
                        ? "text-red-400"
                        : "text-zinc-400"
                  }
                >
                  {fmtUsd(p.paperPnlUsd)}
                </span>
              );
            }
            return (
              <tr key={p.id}>
                <td className="py-1.5 pr-3 font-mono text-zinc-100">
                  {p.asset}
                </td>
                <td
                  className={`py-1.5 pr-3 ${p.side === "long" ? "text-emerald-400" : "text-red-400"}`}
                >
                  {p.side}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">
                  {p.leverage}x
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">
                  ${p.stakeUsd.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">
                  {p.entryMark.toFixed(p.entryMark < 1 ? 6 : 2)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">
                  {ref != null ? ref.toFixed(ref < 1 ? 6 : 2) : "—"}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {pnlDisplay}
                </td>
                <td className="py-1.5 text-right text-zinc-500">
                  {fmtTs(live ? p.entryTs : p.exitTs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const cls = map[status] ?? "bg-zinc-800 text-zinc-300 border-zinc-700";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {status}
    </span>
  );
}
