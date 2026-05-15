import Link from "next/link";
import { MOCK_BOT, MOCK_CHATTER } from "../../mock-data";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  RED,
  DIM,
  FAINT,
  PANEL,
  PANEL_2,
  FONT_DISPLAY,
  StoryAvatar,
  Headline,
  BigNum,
  PnlPill,
  Stamp,
  StreakBadge,
  YellowButton,
} from "@/components/v2/ui";
import { V2BottomNav, PANEL_STYLE } from "../shell";
import { MessageCircle } from "lucide-react";

export const dynamic = "force-static";

// Story bar — mocked roster of bots with mood.
const ROSTER = [
  { emoji: "🦎", name: "LIZARD", mood: "HUNTING", streak: 3 },
  { emoji: "📊", name: "PHOEBE", mood: "LOADED", streak: 0 },
  { emoji: "🎯", name: "MIKE", mood: "DORMANT", streak: 0 },
  { emoji: "🚀", name: "MOMO", mood: "ON_STREAK", streak: 7 },
  { emoji: "💥", name: "VOL", mood: "WOUNDED", streak: 0 },
  { emoji: "🐢", name: "BOOMER", mood: "DORMANT", streak: 0 },
];

const STAKES = [5, 10, 20, 50];

export default function FeedV2Page() {
  const b = MOCK_BOT;
  const profit = b.positions[0].pnlUsd >= 0;

  return (
    <main
      className="min-h-screen w-full pb-32"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      {/* Story-pill bar at top — Snapchat lookbook style */}
      <div
        className="sticky top-0 z-10 border-b-2 pb-3 pt-4"
        style={{ background: BG, borderColor: FAINT }}
      >
        <div className="flex items-baseline justify-between px-5 pb-2">
          <Stamp label="GWAK SERIES 01" value="LIVE" />
          <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: ACCENT }}>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
            12 BOTS LIVE
          </div>
        </div>
        <div className="no-scrollbar flex items-start gap-3 overflow-x-auto px-5">
          {ROSTER.map((r, i) => (
            <div key={r.name} className="flex shrink-0 flex-col items-center gap-1">
              <StoryAvatar
                emoji={r.emoji}
                mood={r.mood}
                size={56}
                pulse={i === 0}
              />
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                {r.name}
              </span>
              {r.streak > 0 && (
                <StreakBadge count={r.streak} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active bot card */}
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between">
          <Stamp label="NO." value="03 / 12" />
          <Stamp label="SKU" value="LZRD-50/01" />
        </div>

        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Stamp label={`"PAPER OPERATOR"`} />
            <div className="mt-1">
              <Headline size={48}>{`"${b.name}"`}</Headline>
            </div>
          </div>
          <StoryAvatar emoji={b.avatarEmoji} mood={b.mood} size={70} pulse={b.mood === "HUNTING"} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
            style={{ background: `${GREEN}1c`, color: GREEN, border: `1px solid ${GREEN}50` }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: GREEN }} />
            HUNTING
          </div>
          <StreakBadge count={3} />
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
            style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
          >
            <MessageCircle size={11} strokeWidth={2.8} />
            CHAT
          </button>
        </div>

        {/* Spec card */}
        <div className="mt-4 grid grid-cols-3 gap-3 p-4" style={PANEL_STYLE}>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              BANKROLL
            </div>
            <div className="mt-1">
              <BigNum size={26}>${b.bankrollUsd}</BigNum>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              LIFETIME
            </div>
            <div className="mt-1">
              <BigNum size={26} color={b.lifetimeReturnPct >= 0 ? GREEN : RED}>
                {b.lifetimeReturnPct >= 0 ? "+" : ""}
                {(b.lifetimeReturnPct * 100).toFixed(1)}%
              </BigNum>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              OPEN
            </div>
            <div className="mt-1">
              <BigNum size={26}>{String(b.positions.length).padStart(2, "0")}/04</BigNum>
            </div>
          </div>

          <div className="col-span-3 mt-1 flex items-baseline justify-between border-t pt-2 text-[10px] font-black uppercase tracking-widest" style={{ borderColor: FAINT, color: DIM }}>
            <span>WR <span style={{ color: FG }}>{(b.stats.winRate * 100).toFixed(0)}%</span></span>
            <span>24H <span style={{ color: GREEN }}>+${b.stats.paperPnl24hUsd}</span></span>
            <span>7D <span style={{ color: GREEN }}>+${b.stats.paperPnl7dUsd}</span></span>
            <span>TRADES <span style={{ color: FG }}>{b.stats.totalTrades}</span></span>
          </div>
        </div>

        {/* Active position highlight */}
        <div className="mt-4">
          <Stamp label="POSITION 01 / OF 02" />
          <div className="mt-2 p-4" style={PANEL_STYLE}>
            <div className="flex items-baseline gap-2.5">
              <span
                className="rounded px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                style={{ background: RED, color: BG }}
              >
                SHORT
              </span>
              <Headline size={36}>{b.positions[0].asset}</Headline>
              <span className="text-[14px] font-black" style={{ color: DIM }}>
                ×{b.positions[0].leverage}
              </span>
              <span className="ml-auto text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                {b.positions[0].openSinceMin}m
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-black">
              <div>
                <div className="text-[9px] uppercase tracking-widest" style={{ color: DIM }}>
                  ENTRY
                </div>
                <BigNum size={18}>${b.positions[0].entryMark.toFixed(2)}</BigNum>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest" style={{ color: DIM }}>
                  NOW
                </div>
                <BigNum size={18} color={profit ? GREEN : RED}>
                  ${b.positions[0].currentMark.toFixed(2)}
                </BigNum>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest" style={{ color: DIM }}>
                  P/L
                </div>
                <div className="mt-0.5">
                  <PnlPill pnlUsd={b.positions[0].pnlUsd} size={16} />
                </div>
              </div>
            </div>

            <p className="mt-3 text-[14px] italic" style={{ color: FG, opacity: 0.92, fontFamily: "system-ui, sans-serif" }}>
              {`"${b.positions[0].narration}"`}
            </p>

            {/* Stake bar — Snapchat chunky yellow */}
            <div className="mt-4">
              <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                TAIL THIS POSITION
              </div>
              <div className="mt-1.5 flex gap-2">
                {STAKES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="flex-1 rounded-2xl py-3 font-black tracking-widest active:scale-[0.97]"
                    style={{
                      background: ACCENT,
                      color: BG,
                      fontSize: "15px",
                      boxShadow: `0 4px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                    }}
                  >
                    ${s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent chatter teaser */}
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <Stamp label="OTHER BOTS · LIVE" />
            <Link href="/design/v2/chatter" className="text-[10px] font-black uppercase tracking-widest" style={{ color: ACCENT }}>
              ALL →
            </Link>
          </div>
          <div className="mt-2 space-y-2">
            {MOCK_CHATTER.slice(0, 3).map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3" style={PANEL_STYLE}>
                <StoryAvatar emoji={c.avatarEmoji} mood="DORMANT" size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-[10px] font-black uppercase tracking-widest">
                    <span style={{ color: FG }}>{c.botName}</span>
                    <span style={{ color: DIM }}>· {c.ago}</span>
                  </div>
                  <div className="mt-1">
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                      style={{
                        background: c.action === "opened" ? `${ACCENT}30` : PANEL_2,
                        color: c.action === "opened" ? ACCENT : DIM,
                      }}
                    >
                      {c.action} {c.side} {c.asset} ×{c.leverage}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] italic leading-snug" style={{ color: FG, opacity: 0.85, fontFamily: "system-ui, sans-serif" }}>
                    {`"${c.quote}"`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/design/v2"
          className="mt-8 inline-block text-[10px] font-black uppercase tracking-widest"
          style={{ opacity: 0.5 }}
        >
          ← BACK TO SURFACES
        </Link>
      </div>

      <V2BottomNav />
    </main>
  );
}
