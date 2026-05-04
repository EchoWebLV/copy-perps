"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";

// Target launch timestamp (UTC). 2 days from 2026-05-04T18:14:39Z.
const LAUNCH_AT_MS = Date.UTC(2026, 4, 6, 18, 14, 39); // months are 0-indexed
// Flip to true to re-enable the login/Enter buttons. The countdown
// auto-hides itself once the launch time passes regardless.
const SHOW_LOGIN = false;

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  reached: boolean;
}

function diff(toMs: number): Remaining {
  const ms = Math.max(0, toMs - Date.now());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return { days, hours, minutes, seconds, reached: ms === 0 };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function CountdownCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-3xl font-black tabular-nums text-white shadow-[0_0_30px_rgba(74,222,128,0.08)] backdrop-blur-md sm:px-5 sm:py-3.5 sm:text-4xl"
      >
        {pad(value)}
      </div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[2px] text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function Countdown() {
  const [remaining, setRemaining] = useState<Remaining>(() => diff(LAUNCH_AT_MS));

  useEffect(() => {
    const id = setInterval(() => setRemaining(diff(LAUNCH_AT_MS)), 1000);
    return () => clearInterval(id);
  }, []);

  if (remaining.reached) {
    return (
      <div className="mt-8 text-sm font-bold uppercase tracking-[3px] text-[#22c55e]">
        Launching now
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center">
      <div className="text-[10px] font-bold uppercase tracking-[3px] text-neutral-500">
        Live in
      </div>
      <div className="mt-3 flex items-center gap-2 sm:gap-3">
        <CountdownCell value={remaining.days} label="Days" />
        <span className="text-2xl font-black text-neutral-700 sm:text-3xl">
          :
        </span>
        <CountdownCell value={remaining.hours} label="Hours" />
        <span className="text-2xl font-black text-neutral-700 sm:text-3xl">
          :
        </span>
        <CountdownCell value={remaining.minutes} label="Minutes" />
        <span className="text-2xl font-black text-neutral-700 sm:text-3xl">
          :
        </span>
        <CountdownCell value={remaining.seconds} label="Seconds" />
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();

  return (
    <main className="gwak-breathe flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Image
        src="/logo.png"
        alt="gwak.gg"
        width={1280}
        height={853}
        priority
        className="h-auto w-full max-w-[360px] drop-shadow-[0_0_30px_rgba(74,222,128,0.18)]"
      />

      <Countdown />

      {SHOW_LOGIN && !ready && (
        <div className="mt-10 text-sm text-neutral-600">Loading…</div>
      )}

      {SHOW_LOGIN && ready && !authenticated && (
        <button
          onClick={login}
          className="mt-10 rounded-2xl bg-white px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Log in
        </button>
      )}

      {SHOW_LOGIN && ready && authenticated && (
        <Link
          href="/feed"
          className="mt-10 rounded-2xl bg-[#22c55e] px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Enter →
        </Link>
      )}
    </main>
  );
}
