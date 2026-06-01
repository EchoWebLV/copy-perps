"use client";

import { useState, type FormEvent } from "react";
import { ACCENT, BG, DIM, FAINT, FG, PANEL } from "@/components/v2/ui";

export default function InvitePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      </div>
    </main>
  );
}
