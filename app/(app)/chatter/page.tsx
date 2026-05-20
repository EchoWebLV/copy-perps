import { getChatterEvents, type ChatterEvent } from "@/lib/bots/chatter";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  RED,
  DIM,
  FAINT,
  PANEL_2,
  FONT_DISPLAY,
  StoryAvatar,
  Headline,
  PnlPill,
} from "@/components/v2/ui";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const EVENT_LIMIT = 80;
const BODY_FONT = "system-ui, -apple-system, 'Inter', sans-serif";

function fmtAge(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

function EventRow({ ev }: { ev: ChatterEvent }) {
  const isOpen = ev.kind === "open";
  const isLong = ev.side === "long";

  return (
    <li
      className="flex items-start gap-3 px-5 py-4"
      style={{ borderBottom: `1px solid ${FAINT}`, fontFamily: BODY_FONT }}
    >
      <StoryAvatar
        emoji={ev.avatarEmoji}
        imageUrl={ev.avatarImageUrl}
        mood="DORMANT"
        size={40}
      />

      <div className="min-w-0 flex-1">
        {/* Top line: name + verb + asset · age */}
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <div className="min-w-0 flex-1 truncate">
            <span className="font-bold" style={{ color: FG }}>
              {ev.botName}
            </span>{" "}
            <span style={{ color: DIM }}>{isOpen ? "opened" : "closed"}</span>{" "}
            <span
              className="rounded px-1 py-px text-[10px] font-bold uppercase"
              style={{
                background: isLong ? `${GREEN}22` : `${RED}22`,
                color: isLong ? GREEN : RED,
              }}
            >
              {ev.side}
            </span>{" "}
            <span className="font-bold" style={{ color: FG }}>
              {ev.asset}
            </span>{" "}
            <span style={{ color: DIM }}>{ev.leverage}×</span>
          </div>
          <span
            className="shrink-0 text-[11px]"
            style={{ color: DIM }}
          >
            {fmtAge(ev.ts)}
          </span>
        </div>

        {/* Quote */}
        <p
          className="mt-1.5 text-[14px] leading-snug"
          style={{ color: FG, opacity: 0.92 }}
        >
          {`"${ev.narration}"`}
        </p>

        {/* Footer: meta + P/L pill */}
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: DIM }}
          >
            <span>entry {fmtPrice(ev.entryMark)}</span>
            {ev.kind === "close" && ev.exitMark !== null && (
              <>
                <span>·</span>
                <span>exit {fmtPrice(ev.exitMark)}</span>
              </>
            )}
            {ev.stakeUsd > 0 && (
              <>
                <span>·</span>
                <span>${ev.stakeUsd.toFixed(0)} stake</span>
              </>
            )}
          </div>
          {ev.kind === "close" && ev.paperPnlUsd !== null && (
            <PnlPill pnlUsd={ev.paperPnlUsd} size={12} />
          )}
        </div>
      </div>
    </li>
  );
}

export default async function ChatterPage() {
  const events = await getChatterEvents(EVENT_LIMIT);

  return (
    <AppShell
      railTitle="Chatter Context"
      rail={
        <div
          className="rounded-xl p-4 text-[12px] leading-relaxed"
          style={{ background: PANEL_2, border: `1px solid ${FAINT}`, color: DIM }}
        >
          Latest bot trade narration streams here. Use roster and live views for
          action context.
        </div>
      }
      mainClassName="overflow-hidden"
    >
      <div
        className="no-scrollbar mx-auto h-full w-full max-w-md overflow-y-auto pb-32 lg:max-w-none lg:px-6 lg:pb-6"
        style={{
          background: BG,
          color: FG,
        }}
      >
        {/* Header — hypebeast styling reserved for the page title */}
        <header
          className="sticky top-0 z-10 border-b-2 px-5 pt-5 pb-3"
          style={{ background: BG, borderColor: FAINT, fontFamily: FONT_DISPLAY }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <Headline size={28}>{`"CHATTER"`}</Headline>
              <p
                className="mt-1 text-[11px]"
                style={{ color: DIM, fontFamily: BODY_FONT }}
              >
                Every bot, every trade, in their voice.
              </p>
            </div>
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
              style={{
                background: `${ACCENT}20`,
                color: ACCENT,
                border: `1px solid ${ACCENT}40`,
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }}
              />
              LIVE
            </div>
          </div>
        </header>

        {events.length === 0 ? (
          <div
            className="px-5 py-20 text-center"
            style={{ fontFamily: BODY_FONT }}
          >
            <div style={{ fontFamily: FONT_DISPLAY }}>
              <Headline size={26}>{`"NO CHATTER YET"`}</Headline>
            </div>
            <p className="mt-3 text-[12px]" style={{ color: DIM }}>
              Bots will speak up the moment they open or close a position.
            </p>
          </div>
        ) : (
          <ul>
            {events.map((ev) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </ul>
        )}
      </div>
      <BottomNav />
    </AppShell>
  );
}
