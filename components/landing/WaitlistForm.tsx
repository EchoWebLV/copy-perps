"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "error";

const ERROR_COPY: Record<string, string> = {
  invalid_email: "That email doesn't look right.",
  invalid_body: "Something went wrong, try again.",
  bot_check_failed: "Something went wrong, try again.",
  server_error: "Something went wrong, try again.",
};

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setStatus("success");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const code = typeof data.error === "string" ? data.error : "server_error";
      setErrorMsg(ERROR_COPY[code] ?? ERROR_COPY.server_error);
      setStatus("error");
    } catch {
      setErrorMsg(ERROR_COPY.server_error);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="mt-8 text-sm font-bold uppercase tracking-[3px] text-[#22c55e]">
        You&apos;re on the list ✓
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-8 flex w-full max-w-sm flex-col items-center gap-3 px-4"
    >
      <input
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="you@degenmail.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === "submitting"}
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-neutral-500 backdrop-blur-md focus:border-white/30 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-2xl bg-white px-6 py-3 text-base font-bold text-black transition active:scale-[0.97] disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting…" : "Get on the list"}
      </button>
      {status === "error" && errorMsg && (
        <p className="text-xs font-medium text-red-400">{errorMsg}</p>
      )}
    </form>
  );
}
