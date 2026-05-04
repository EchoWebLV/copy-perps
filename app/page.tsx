"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();

  return (
    <main className="gwak-breathe flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Image
        src="/logo.jpeg"
        alt="gwak.gg"
        width={1280}
        height={853}
        priority
        className="h-auto w-full max-w-[360px] drop-shadow-[0_0_30px_rgba(74,222,128,0.18)]"
      />

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
          Enter →
        </Link>
      )}
    </main>
  );
}
