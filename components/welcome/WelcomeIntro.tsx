"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "gwak.welcomed.v1";
const SLIDE_COUNT = 2;

// First-open intro. Localised to the device — backed by localStorage,
// not the users table — so it shows once per browser even before login.
// Mounted at the (app)/layout level so it covers any first app surface
// the user lands on (feed, portfolio, deposit, etc.).
//
// Visual language matches the rail picker (PreferencesProvider): solid
// black, mono eyebrow with step counter, 44px tracking-tight headline,
// numbered rows with vertical accent stripes, white-on-black CTA.
export function WelcomeIntro() {
  const [shown, setShown] = useState(false);
  const [slide, setSlide] = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShown(true);
    }
  }, []);

  if (!shown) return null;

  const advance = () => {
    if (slide < SLIDE_COUNT - 1) {
      setSlide((s) => s + 1);
    } else {
      finish();
    }
  };

  const finish = () => {
    setClosing(true);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {}
    setTimeout(() => setShown(false), 360);
  };

  const stepLabel = `// step ${String(slide + 1).padStart(2, "0")} / ${String(
    SLIDE_COUNT,
  ).padStart(2, "0")}`;

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto bg-[#080808] text-white ${
        closing ? "welcome-out" : "welcome-in"
      }`}
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col px-7 pb-10 pt-14">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">
          {stepLabel}
        </div>

        {slide === 0 && <SlideWhat />}
        {slide === 1 && <SlideHow />}

        {/* CTA pinned to bottom of column, mirrors the picker layout */}
        <div className="mt-auto pt-12">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={finish}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 transition hover:text-white"
            >
              [esc] skip
            </button>
            <button
              type="button"
              onClick={advance}
              className="ml-auto flex items-center gap-3 bg-white px-7 py-4 text-sm font-bold uppercase tracking-[0.15em] text-black transition active:scale-[0.97]"
            >
              <span>
                {slide < SLIDE_COUNT - 1 ? "Continue" : "Let's go"}
              </span>
              <span className="font-mono">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Row {
  num: string;
  label: string;
  description: string;
  stripe: string;
}

const RAIL_ROWS: Row[] = [
  {
    num: "01",
    label: "Memecoins",
    description: "Trending Solana tokens",
    stripe: "linear-gradient(180deg, hsl(15 95% 55%), hsl(15 80% 35%))",
  },
  {
    num: "02",
    label: "Predictions",
    description: "Yes / No on real-world events",
    stripe: "linear-gradient(180deg, hsl(220 90% 60%), hsl(220 75% 35%))",
  },
  {
    num: "03",
    label: "Leverage",
    description: "Bet with top traders",
    stripe: "linear-gradient(180deg, hsl(285 80% 60%), hsl(285 65% 35%))",
  },
];

const HOW_ROWS: Row[] = [
  {
    num: "01",
    label: "Stake",
    description: "Pick $5, $10, $20 or $50 on any card",
    stripe: "linear-gradient(180deg, hsl(142 70% 55%), hsl(142 60% 35%))",
  },
  {
    num: "02",
    label: "Ask Gwak",
    description: "Tap the bot icon for a live AI take",
    stripe: "linear-gradient(180deg, hsl(160 70% 55%), hsl(160 60% 35%))",
  },
  {
    num: "03",
    label: "Bookmark",
    description: "Save signals to your portfolio",
    stripe: "linear-gradient(180deg, hsl(45 90% 55%), hsl(45 75% 35%))",
  },
];

function SlideWhat() {
  return (
    <div key="s0" className="welcome-slide">
      <h1 className="mt-5 text-[44px] font-bold leading-[0.95] tracking-tight">
        Three rails.
        <br />
        One feed.
      </h1>
      <p className="mt-4 max-w-[18rem] text-sm leading-relaxed text-neutral-400">
        Welcome to gwak — a TikTok-style feed for degens. Scroll, tap, stake.
        All on Solana.
      </p>
      <RowList rows={RAIL_ROWS} />
    </div>
  );
}

function SlideHow() {
  return (
    <div key="s1" className="welcome-slide">
      <h1 className="mt-5 text-[44px] font-bold leading-[0.95] tracking-tight">
        One tap.
        <br />
        One bet.
      </h1>
      <p className="mt-4 max-w-[18rem] text-sm leading-relaxed text-neutral-400">
        Three things to know before you start.
      </p>
      <RowList rows={HOW_ROWS} />
    </div>
  );
}

function RowList({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-12 flex flex-col">
      {rows.map((r, i) => (
        <div
          key={r.num}
          className={`relative -mx-7 px-7 py-6 ${
            i === 0 ? "border-t border-white/[0.08]" : ""
          } border-b border-white/[0.08]`}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: r.stripe }}
          />
          <div className="flex items-baseline gap-5">
            <span className="font-mono text-[11px] tabular-nums tracking-wider text-white">
              {r.num}
            </span>
            <div className="flex-1">
              <div className="text-2xl font-bold uppercase leading-none tracking-tight text-white">
                {r.label}
              </div>
              <div className="mt-2 text-[13px] leading-snug text-neutral-400">
                {r.description}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
