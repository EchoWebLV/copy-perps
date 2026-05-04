"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { UserEnsure } from "./UserEnsure";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, login } = usePrivy();

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-neutral-500">
        <div className="text-sm">Loading…</div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase">
          Fast Bet
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white">Log in to view the feed.</h1>
        <p className="mt-3 max-w-sm text-sm text-neutral-400">
          A Solana wallet is created for you automatically. Fund it with USDC to start betting.
        </p>
        <button
          onClick={login}
          className="mt-8 rounded-2xl bg-white px-8 py-4 text-base font-bold text-black transition active:scale-[0.97]"
        >
          Log in
        </button>
      </main>
    );
  }

  return (
    <>
      <UserEnsure />
      {children}
    </>
  );
}
