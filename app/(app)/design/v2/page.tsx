import Link from "next/link";
import { BG, FG, ACCENT, FONT_DISPLAY, PANEL, FAINT } from "@/components/v2/ui";

export const dynamic = "force-static";

const SURFACES = [
  {
    href: "/design/v2/feed",
    label: "FEED",
    blurb: "Bot card swipe — story bar, win streak, big stake buttons.",
  },
  {
    href: "/design/v2/chatter",
    label: "CHATTER",
    blurb: "Live timeline of every bot's open/close, big pull-quotes.",
  },
  {
    href: "/design/v2/portfolio",
    label: "PORTFOLIO",
    blurb: "Your tail trades — equity curve, open positions, history.",
  },
  {
    href: "/design/v2/settings",
    label: "SETTINGS",
    blurb: "Wallet, notifications, theme. Boring but well-dressed.",
  },
];

export default function V2IndexPage() {
  return (
    <main
      className="min-h-screen w-full px-5 pt-10 pb-16"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div
        className="text-[10px] font-black uppercase tracking-[0.3em]"
        style={{ opacity: 0.55 }}
      >
        DESIGN v2 — DARK HYPEBEAST × SNAPCHAT × TRADING
      </div>

      <h1
        className="mt-2 font-black uppercase leading-[0.9]"
        style={{
          fontSize: "52px",
          letterSpacing: "-0.03em",
          fontStretch: "condensed",
        }}
      >
        {`"PICK A`}
        <br />
        <span style={{ background: ACCENT, color: BG, padding: "0 0.1em" }}>
          SURFACE
        </span>
        {`"`}
      </h1>

      <p
        className="mt-3 text-[12px] leading-snug"
        style={{ opacity: 0.7, fontFamily: "system-ui, sans-serif" }}
      >
        Dark trading-app substrate. Snapchat-yellow CTAs, story-ring bot
        avatars, streak counters. Hypebeast condensed headlines + factory
        stamps for hierarchy. Pick a surface to walk through.
      </p>

      <div className="mt-8 space-y-3">
        {SURFACES.map((s, i) => (
          <Link
            key={s.href}
            href={s.href}
            className="group block px-4 py-4 transition active:scale-[0.99]"
            style={{
              background: PANEL,
              borderRadius: 18,
              border: `1px solid ${FAINT}`,
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="font-black uppercase"
                style={{
                  fontSize: "28px",
                  letterSpacing: "-0.03em",
                  fontStretch: "condensed",
                }}
              >
                {String(i + 1).padStart(2, "0")} · {s.label}
              </span>
              <span
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: ACCENT }}
              >
                view →
              </span>
            </div>
            <p
              className="mt-1 text-[12px]"
              style={{ opacity: 0.6, fontFamily: "system-ui, sans-serif" }}
            >
              {s.blurb}
            </p>
          </Link>
        ))}
      </div>

      <Link
        href="/design"
        className="mt-8 inline-block text-[10px] font-black uppercase tracking-widest"
        style={{ opacity: 0.5 }}
      >
        ← ALL STYLES
      </Link>
    </main>
  );
}
