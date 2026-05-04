"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase">
        Fast Bet
      </div>
      <h1 className="text-5xl font-black tracking-tight text-white">
        All the short market spam.
      </h1>
      <h2 className="mt-2 text-5xl font-black tracking-tight text-neutral-500">
        One feed.
      </h2>
      <p className="mt-6 max-w-md text-base text-neutral-400">
        Hot meme coins. Hot Polymarket. Hot whale leverage. Tap to bet.
      </p>

      {!ready && (
        <div className="mt-10 text-sm text-neutral-600">Loading…</div>
      )}

      {ready && !authenticated && (
        <button
          onClick={login}
          className="mt-10 rounded-2xl bg-white px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Log in
        </button>
      )}

      {ready && authenticated && (
        <Link
          href="/feed"
          className="mt-10 rounded-2xl bg-[#22c55e] px-8 py-4 text-lg font-bold text-black transition active:scale-[0.97]"
        >
          Open feed →
        </Link>
      )}
    </main>
  );
}
