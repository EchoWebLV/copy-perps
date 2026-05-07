"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const STORAGE_KEY = "gwak.welcomed.v1";
const SLIDE_COUNT = 3;

// First-open intro. Localised to the device — backed by localStorage,
// not the users table — so it shows once per browser even before login.
// Mounted at the (app)/layout level so it covers the feed, portfolio,
// or any other app surface the user lands on first.
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
    setTimeout(() => setShown(false), 450);
  };

  return (
    <div
      className={`welcome-overlay gwak-breathe ${closing ? "welcome-out" : "welcome-in"}`}
      onClick={advance}
    >
      {/* Skip — top-right, doesn't intercept the tap-anywhere advance */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        className="welcome-skip"
        aria-label="Skip intro"
      >
        Skip
      </button>

      <div className="welcome-stage">
        {slide === 0 && <SlideWelcome />}
        {slide === 1 && <SlideRails />}
        {slide === 2 && <SlideStart onStart={finish} />}
      </div>

      <div className="welcome-dots" aria-hidden>
        {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
          <span
            key={i}
            className={`welcome-dot ${i === slide ? "welcome-dot-on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function SlideWelcome() {
  return (
    <div key="s0" className="welcome-slide flex flex-col items-center text-center">
      <div className="welcome-logo-wrap">
        <Image
          src="/logo.png"
          alt="gwak.gg"
          width={1280}
          height={853}
          priority
          className="welcome-logo h-auto w-[280px] drop-shadow-[0_0_40px_rgba(74,222,128,0.25)]"
        />
      </div>
      <h1 className="welcome-h1 mt-8 text-4xl font-black tracking-tight">
        Welcome to <span className="welcome-grad">gwak</span>
      </h1>
      <p className="welcome-sub mt-3 text-lg text-neutral-300">
        the degen feed
      </p>
      <p className="welcome-hint mt-12 text-sm text-neutral-500">
        Tap anywhere to continue
      </p>
    </div>
  );
}

function SlideRails() {
  const rails = [
    {
      emoji: "🪙",
      name: "Memes",
      desc: "Buy hot Solana tokens",
      color: "#ff5e3a",
    },
    {
      emoji: "🎯",
      name: "Predictions",
      desc: "Yes/No on real markets",
      color: "#2563eb",
    },
    {
      emoji: "🐋",
      name: "Whales",
      desc: "Tail or fade pro traders",
      color: "#7c3aed",
    },
  ];
  return (
    <div key="s1" className="welcome-slide flex flex-col text-left">
      <h2 className="welcome-h1 text-center text-3xl font-black tracking-tight">
        Three rails.<br />One feed.
      </h2>
      <div className="mt-10 flex flex-col gap-3">
        {rails.map((r, i) => (
          <div
            key={r.name}
            className="welcome-rail"
            style={{
              animationDelay: `${120 + i * 110}ms`,
              borderColor: `${r.color}55`,
              background: `linear-gradient(120deg, ${r.color}22, ${r.color}08 60%)`,
            }}
          >
            <span className="text-3xl">{r.emoji}</span>
            <div>
              <div className="text-base font-bold">{r.name}</div>
              <div className="text-sm text-neutral-300">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="welcome-hint mt-10 text-center text-sm text-neutral-500">
        Tap to continue
      </p>
    </div>
  );
}

function SlideStart({ onStart }: { onStart: () => void }) {
  const tips = [
    {
      icon: "💸",
      title: "One-tap stakes",
      desc: "Pick $5, $10, $20 or $50 on any card",
    },
    {
      icon: "🤖",
      title: "Ask Gwak",
      desc: "Tap the bot icon for an AI take",
    },
    {
      icon: "🔖",
      title: "Bookmark",
      desc: "Save signals to your portfolio",
    },
  ];
  return (
    <div
      key="s2"
      className="welcome-slide flex flex-col text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="welcome-h1 text-center text-3xl font-black tracking-tight">
        Get started
      </h2>
      <div className="mt-8 flex flex-col gap-4">
        {tips.map((t, i) => (
          <div
            key={t.title}
            className="welcome-tip"
            style={{ animationDelay: `${120 + i * 110}ms` }}
          >
            <span className="text-2xl">{t.icon}</span>
            <div>
              <div className="text-base font-bold">{t.title}</div>
              <div className="text-sm text-neutral-300">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onStart}
        className="welcome-cta mt-10 self-center rounded-2xl bg-emerald-400 px-10 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
      >
        Let&apos;s go →
      </button>
    </div>
  );
}
