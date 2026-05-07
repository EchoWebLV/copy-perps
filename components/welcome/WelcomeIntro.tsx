"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const STORAGE_KEY = "gwak.welcomed.v1";

// First-open intro. Localised to the device — backed by localStorage,
// not the users table — so it shows once per browser even before login.
// Mounted at the (app)/layout level so it covers any first app surface.
//
// Visually distinct from the rail picker (which is editorial / solid
// black). This is brand-hero: animated mesh backdrop, prominent logo,
// large display headline, brand-coloured rail chips, full-width
// emerald CTA. No emojis.
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
      className={`fixed inset-0 z-50 overflow-hidden bg-black text-white ${
        closing ? "welcome-out" : "welcome-in"
      }`}
    >
      <div className="welcome-mesh absolute inset-0" />
      <div className="welcome-grain absolute inset-0" />

      <div className="relative flex h-full flex-col px-7 pb-8 pt-6">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={finish}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/45 transition hover:text-white"
            aria-label="Skip intro"
          >
            skip
          </button>
        </div>

        <div className="welcome-logo-wrap mt-2 flex justify-center">
          <Image
            src="/logo.png"
            alt="gwak.gg"
            width={1280}
            height={853}
            priority
            className="h-auto w-[220px] drop-shadow-[0_0_40px_rgba(74,222,128,0.25)]"
          />
        </div>

        <div className="mt-auto">
          <div className="welcome-eyebrow font-mono text-[11px] uppercase tracking-[0.32em] text-emerald-300/90">
            welcome
          </div>

          <h1 className="welcome-headline mt-3 text-[64px] font-black leading-[0.88] tracking-tight">
            Gwak<span className="welcome-grad"> season.</span>
          </h1>

          <p className="welcome-sub mt-5 max-w-[20rem] text-base leading-relaxed text-white/70">
            Memes, predictions, whale plays. Scroll, tap, stake. One feed, all
            on Solana.
          </p>

          <div className="welcome-chips mt-7 flex flex-wrap gap-2">
            <Chip label="Memes" tint="#ff5e3a" />
            <Chip label="Markets" tint="#3b82f6" />
            <Chip label="Whales" tint="#a855f7" />
          </div>

          <div className="welcome-tips mt-8 flex flex-col gap-1.5 text-[13px] text-white/55">
            <TipLine k="01" v="Pick as little as $1 on cards" />
            <TipLine k="02" v="Tap the bot for a live AI take" />
            <TipLine k="03" v="Bookmark signals to your portfolio" />
          </div>
        </div>

        <button
          type="button"
          onClick={finish}
          className="welcome-cta mt-10 flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-400 py-4 text-base font-bold uppercase tracking-[0.15em] text-black transition active:scale-[0.98]"
        >
          <span>Start scrolling</span>
          <span className="font-mono text-lg">→</span>
        </button>
      </div>
    </div>
  );
}

function Chip({ label, tint }: { label: string; tint: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold backdrop-blur-sm"
      style={{
        borderColor: `${tint}55`,
        background: `${tint}1a`,
        color: tint,
      }}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: tint, boxShadow: `0 0 10px ${tint}` }}
      />
      <span>{label}</span>
    </span>
  );
}

function TipLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tabular-nums tracking-wider text-white/35">
        {k}
      </span>
      <span>{v}</span>
    </div>
  );
}
