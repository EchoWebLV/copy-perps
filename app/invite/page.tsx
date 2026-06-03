"use client";

import { useState, type FormEvent } from "react";
import { ACCENT, BG, DIM, FAINT, FG, PANEL } from "@/components/v2/ui";

type WaitState = "idle" | "submitting" | "done" | "error";

export default function InvitePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [waitState, setWaitState] = useState<WaitState>("idle");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || code.trim().length === 0) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        window.location.href = "/feed";
        return;
      }
      setError(true);
    } catch {
      setError(true);
    }
    setSubmitting(false);
  }

  async function onWaitlist(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (waitState === "submitting") return;
    if (!/\S+@\S+\.\S+/.test(value)) {
      setWaitState("error");
      return;
    }
    setWaitState("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      setWaitState(res.ok ? "done" : "error");
    } catch {
      setWaitState("error");
    }
  }

  return (
    <main
      className="flex min-h-[100dvh] flex-col items-center justify-center px-6"
      style={{ background: BG, color: FG }}
    >
      <div className="w-full max-w-[380px]">
        <div className="text-center text-[44px] font-black uppercase leading-none tracking-tighter">
          GWAK<span style={{ color: ACCENT }}>.GG</span>
        </div>
        <p
          className="mt-3 mb-8 text-center text-[11px] font-black uppercase tracking-[0.35em]"
          style={{ color: DIM }}
        >
          Invite only
        </p>

        <form onSubmit={onSubmit}>
          <input
            autoFocus
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(false);
            }}
            placeholder="ENTER INVITE CODE"
            aria-label="Invite code"
            className="w-full rounded-2xl px-4 py-4 text-center text-[15px] font-black uppercase tracking-[0.2em] outline-none"
            style={{
              background: PANEL,
              color: FG,
              border: `1px solid ${error ? "#ff4d4d" : FAINT}`,
            }}
          />
          <button
            type="submit"
            disabled={submitting}
            className="mt-3 w-full rounded-2xl py-4 text-[13px] font-black uppercase tracking-[0.2em] transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: ACCENT, color: BG }}
          >
            {submitting ? "CHECKING…" : "ENTER"}
          </button>
        </form>

        {error && (
          <p
            className="mt-4 text-center text-[11px] font-black uppercase tracking-widest"
            style={{ color: "#ff4d4d" }}
          >
            Wrong code
          </p>
        )}

        <div className="mt-10 mb-6 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1" style={{ background: FAINT }} />
          <span
            className="text-[10px] font-black uppercase tracking-[0.3em]"
            style={{ color: DIM }}
          >
            No code?
          </span>
          <span className="h-px flex-1" style={{ background: FAINT }} />
        </div>

        {waitState === "done" ? (
          <p
            className="text-center text-[12px] font-black uppercase tracking-[0.2em]"
            style={{ color: ACCENT }}
          >
            You&apos;re on the list ✓
            <span
              className="mt-2 block text-[10px] font-bold tracking-[0.15em]"
              style={{ color: DIM }}
            >
              We&apos;ll email you when your spot opens.
            </span>
          </p>
        ) : (
          <form onSubmit={onWaitlist}>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (waitState === "error") setWaitState("idle");
              }}
              placeholder="YOUR EMAIL"
              aria-label="Email for the waitlist"
              className="w-full rounded-2xl px-4 py-4 text-center text-[14px] font-bold tracking-[0.12em] outline-none"
              style={{
                background: PANEL,
                color: FG,
                border: `1px solid ${waitState === "error" ? "#ff4d4d" : FAINT}`,
              }}
            />
            <button
              type="submit"
              disabled={waitState === "submitting"}
              className="mt-3 w-full rounded-2xl py-4 text-[12px] font-black uppercase tracking-[0.2em] transition active:scale-[0.98] disabled:opacity-50"
              style={{
                background: "transparent",
                color: ACCENT,
                border: `1px solid ${ACCENT}`,
              }}
            >
              {waitState === "submitting" ? "JOINING…" : "Join the waitlist"}
            </button>
            {waitState === "error" && (
              <p
                className="mt-3 text-center text-[11px] font-black uppercase tracking-widest"
                style={{ color: "#ff4d4d" }}
              >
                Enter a valid email
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
