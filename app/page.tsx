"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import { ev } from "@/lib/analytics";
import { WaitlistForm } from "@/components/landing/WaitlistForm";

// Flip to true to swap the waitlist form for the Login / Enter buttons.
const SHOW_LOGIN = false;

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

      {!SHOW_LOGIN && <WaitlistForm />}

      {SHOW_LOGIN && !ready && (
        <div className="mt-10 text-sm text-neutral-600">Loading…</div>
      )}

      {SHOW_LOGIN && ready && !authenticated && (
        <button
          onClick={() => {
            ev.loginClicked("landing");
            login();
          }}
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
