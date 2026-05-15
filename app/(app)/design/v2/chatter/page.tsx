import Link from "next/link";
import { MOCK_CHATTER } from "../../mock-data";
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
  Stamp,
  Headline,
  PnlPill,
} from "@/components/v2/ui";
import { V2BottomNav, V2Header, PANEL_STYLE } from "../shell";

export const dynamic = "force-static";

// Mood per bot — used for the story ring color.
const BOT_MOOD: Record<string, string> = {
  "Liquidation Lizard": "HUNTING",
  "Funding Phoebe Lite": "LOADED",
  "Mean-Revert Mike Patient": "DORMANT",
  "Momo Max Aggressive": "ON_STREAK",
  "Vol Vector Hair-Trigger": "WOUNDED",
};

export default function ChatterV2Page() {
  return (
    <main
      className="min-h-screen w-full pb-32"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <V2Header
        title={`"CHATTER"`}
        subtitle="EVERY BOT · EVERY TRADE · IN THEIR VOICE"
        trailing={
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
        }
      />

      {/* Story bar of recent posters */}
      <div className="px-5 pt-3">
        <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
          RECENT VOICES
        </div>
        <div className="no-scrollbar mt-2 flex items-start gap-3 overflow-x-auto">
          {MOCK_CHATTER.map((c, i) => (
            <div key={c.id} className="flex shrink-0 flex-col items-center gap-1">
              <StoryAvatar
                emoji={c.avatarEmoji}
                mood={BOT_MOOD[c.botName] ?? "DORMANT"}
                size={50}
                pulse={i === 0}
              />
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM, maxWidth: 60 }}>
                {c.botName.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Event timeline */}
      <div className="mt-5 space-y-3 px-5">
        {MOCK_CHATTER.map((c, i) => {
          const isOpen = c.action === "opened";
          const isLong = c.side === "long";
          return (
            <div key={c.id} className="p-4" style={PANEL_STYLE}>
              {/* Counter strip */}
              <div className="flex items-baseline justify-between">
                <Stamp label="CHATTER" value={`#${String(287 + i).padStart(3, "0")}`} />
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  — {c.ago}
                </span>
              </div>

              {/* Bot identity */}
              <div className="mt-2 flex items-center gap-3">
                <StoryAvatar
                  emoji={c.avatarEmoji}
                  mood={BOT_MOOD[c.botName] ?? "DORMANT"}
                  size={48}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-black uppercase" style={{ fontSize: "20px", letterSpacing: "-0.02em", fontStretch: "condensed", lineHeight: 0.95 }}>
                    {c.botName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                      style={{
                        background: isOpen ? `${ACCENT}30` : PANEL_2,
                        color: isOpen ? ACCENT : DIM,
                      }}
                    >
                      {isOpen ? "OPENED" : "CLOSED"}
                    </span>
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                      style={{
                        background: isLong ? `${GREEN}20` : `${RED}20`,
                        color: isLong ? GREEN : RED,
                      }}
                    >
                      {c.side}
                    </span>
                    <Headline size={16}>{c.asset}</Headline>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                      ×{c.leverage}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pull quote */}
              <p
                className="mt-3 leading-snug"
                style={{ fontFamily: "system-ui, sans-serif", fontSize: "16px", color: FG }}
              >
                {`"${c.quote}"`}
              </p>

              {/* P/L if close */}
              {c.pnlUsd != null && (
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    REALIZED
                  </span>
                  <PnlPill pnlUsd={c.pnlUsd} size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Link
        href="/design/v2"
        className="mt-8 inline-block px-5 text-[10px] font-black uppercase tracking-widest"
        style={{ opacity: 0.5 }}
      >
        ← BACK TO SURFACES
      </Link>

      <V2BottomNav />
    </main>
  );
}
