import { getChatterEvents, type ChatterEvent } from "@/lib/bots/chatter";
import { BottomNav } from "@/components/shell/BottomNav";
import { Radio } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const EVENT_LIMIT = 80;

function fmtAge(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

function EventRow({ ev }: { ev: ChatterEvent }) {
  const isLong = ev.side === "long";
  const pnl = ev.paperPnlUsd ?? 0;
  const pnlPositive = pnl >= 0;

  return (
    <li className="border-b border-white/5 px-5 py-3.5 transition hover:bg-white/[0.02]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-2xl leading-none">{ev.avatarEmoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
            <span className="font-bold text-white">{ev.botName}</span>
            <span className="text-white/40">
              {ev.kind === "open" ? "opened" : "closed"}
            </span>
            <span
              className={`rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${
                isLong
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-rose-500/20 text-rose-200"
              }`}
            >
              {ev.side}
            </span>
            <span className="font-bold text-white">{ev.asset}</span>
            <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase text-white/80">
              {ev.leverage}x
            </span>
            {ev.kind === "close" && ev.paperPnlUsd !== null && (
              <span
                className={`text-[11px] font-bold ${
                  pnlPositive ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {pnlPositive ? "+" : ""}${Math.abs(pnl).toFixed(0)}
              </span>
            )}
            <span className="ml-auto text-[10px] text-white/30">
              {fmtAge(ev.ts)}
            </span>
          </div>
          <p className="mt-1 text-[13px] italic leading-snug text-white/85">
            &ldquo;{ev.narration}&rdquo;
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-white/35">
            <span>Entry {fmtPrice(ev.entryMark)}</span>
            {ev.kind === "close" && ev.exitMark !== null && (
              <>
                <span>·</span>
                <span>Exit {fmtPrice(ev.exitMark)}</span>
              </>
            )}
            {ev.stakeUsd > 0 && (
              <>
                <span>·</span>
                <span>${ev.stakeUsd.toFixed(0)} stake</span>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default async function ChatterPage() {
  const events = await getChatterEvents(EVENT_LIMIT);

  return (
    <>
      <main className="mx-auto min-h-screen w-full max-w-md pb-24 text-white">
        <header className="sticky top-0 z-10 border-b border-white/5 bg-black/85 px-5 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-emerald-300" strokeWidth={2.4} />
            <h1 className="text-lg font-bold tracking-tight">Chatter</h1>
            <span className="ml-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
              Live
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-white/50">
            Every bot, every trade, in their own voice.
          </p>
        </header>

        {events.length === 0 ? (
          <div className="px-5 py-20 text-center text-sm text-white/40">
            <p className="font-semibold text-white/60">No chatter yet</p>
            <p className="mt-1 text-xs">
              Bots will speak up the moment they open or close a position.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {events.map((ev) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </ul>
        )}
      </main>
      <BottomNav />
    </>
  );
}
