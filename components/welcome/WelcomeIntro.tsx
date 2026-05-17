"use client";

import { useEffect, useState } from "react";
import {
  BG,
  FG,
  ACCENT,
  FONT_DISPLAY,
  FONT_BODY,
  Headline,
  Stamp,
} from "@/components/v2/ui";

const STORAGE_KEY = "breach.welcomed.v2";

// First-open intro. Localised to the device — backed by localStorage,
// not the users table — so it shows once per browser even before login.
// Mounted at the (app)/layout level so it covers any first app surface.
//
// Styled to match the app's design language: warm near-black substrate,
// acid-yellow accent, condensed hypebeast headline + factory stamps,
// factory-numbered bot rows, chunky yellow CTA.
export function WelcomeIntro() {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShown(true);
    }
  }, []);

  if (!shown) return null;

  const finish = () => {
    setClosing(true);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {}
    setTimeout(() => setShown(false), 380);
  };

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden ${
        closing ? "welcome-out" : "welcome-in"
      }`}
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="welcome-mesh absolute inset-0" />
      <div className="welcome-grain absolute inset-0" />

      <div className="relative flex h-full flex-col px-6 pb-8 pt-6">
        {/* Brand bar — wordmark left, skip right */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="block h-3.5 w-3.5 rounded-[3px]"
              style={{ background: ACCENT }}
            />
            <Headline size={20}>BREACH</Headline>
          </div>
          <button
            type="button"
            onClick={finish}
            className="text-[9px] font-black uppercase tracking-[0.24em] text-[#fafaf2]/45 transition hover:text-[#fafaf2]"
            style={{ fontFamily: FONT_DISPLAY }}
            aria-label="Skip intro"
          >
            skip
          </button>
        </div>

        {/* Content — bottom-anchored */}
        <div className="mt-auto">
          <div className="welcome-eyebrow">
            <Stamp label="WELCOME" />
          </div>

          <div className="welcome-headline mt-3">
            <Headline size={60} color={ACCENT}>{`"BOT`}</Headline>
            <br />
            <Headline size={60}>{`ARENA"`}</Headline>
          </div>

          <p
            className="welcome-sub mt-4 max-w-[20rem] leading-relaxed"
            style={{
              fontFamily: FONT_BODY,
              fontSize: "14px",
              color: "rgba(250,250,242,0.62)",
            }}
          >
            Trading bots that mirror real on-chain whales. Live PnL. Scroll the
            feed and watch them battle.
          </p>

          <div className="welcome-tips mt-7 flex flex-col gap-2.5">
            <TipRow k="01" v="Algo bots mirror real whales" />
            <TipRow k="02" v="Bot trades hit the feed live" />
            <TipRow k="03" v="10K each" />
          </div>
        </div>

        <button
          type="button"
          onClick={finish}
          className="welcome-cta mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-black uppercase tracking-widest transition active:scale-[0.98]"
          style={{
            background: ACCENT,
            color: BG,
            fontFamily: FONT_DISPLAY,
            fontSize: "16px",
            boxShadow: "0 4px 0 #fae50099, inset 0 -2px 0 rgba(0,0,0,0.2)",
          }}
        >
          <span>Enter the arena</span>
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

// One factory-numbered row: acid-yellow index chip + condensed caps line.
function TipRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md tabular-nums"
        style={{
          background: ACCENT,
          color: BG,
          fontFamily: FONT_DISPLAY,
          fontSize: "12px",
          fontWeight: 900,
          letterSpacing: "-0.02em",
        }}
      >
        {k}
      </span>
      <span
        className="font-black uppercase"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: "13px",
          letterSpacing: "0.04em",
          color: FG,
        }}
      >
        {v}
      </span>
    </div>
  );
}
