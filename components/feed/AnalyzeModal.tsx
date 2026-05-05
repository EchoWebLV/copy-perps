"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { X, Sparkles } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { Signal } from "@/lib/types";

interface Props {
  signal: Signal | null;
  onClose: () => void;
}

function titleFor(signal: Signal): string {
  if (signal.type === "meme") return signal.ticker;
  if (signal.type === "prediction") return signal.question;
  if (signal.type === "multiprediction") return signal.question;
  if (signal.type === "whale") return `${signal.asset} ${signal.leverage}× ${signal.side.toUpperCase()}`;
  return "Signal";
}

export function AnalyzeModal({ signal, onClose }: Props) {
  const { getAccessToken } = usePrivy();
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Esc to close
  useEffect(() => {
    if (!signal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signal, onClose]);

  // Kick off the stream when a signal is set; abort + reset when it clears.
  useEffect(() => {
    if (!signal) {
      abortRef.current?.abort();
      abortRef.current = null;
      setText("");
      setDone(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setDone(false);
    setError(null);

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not signed in");
        const r = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ signal }),
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!r.body) throw new Error("no body");

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          const chunk = decoder.decode(value, { stream: true });
          setText((prev) => prev + chunk);
        }
        setDone(true);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        console.error("[analyze]", e);
        setError(e instanceof Error ? e.message : String(e));
        setDone(true);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [signal, getAccessToken]);

  if (!signal) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[88%] w-full flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-[#0a0a0a] text-white"
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-3 border-b border-white/5 px-5 pt-5 pb-4">
          <div className="relative h-12 w-12 flex-none overflow-hidden rounded-full bg-gradient-to-br from-emerald-400/30 to-purple-500/30 ring-2 ring-emerald-300/30">
            <Image
              src="/gwak.PNG"
              alt="Gwak"
              fill
              sizes="48px"
              className="object-cover"
              priority
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black">Gwak</span>
              <Sparkles size={12} className="text-emerald-300" />
              <span className="text-[10px] font-bold tracking-[1.5px] text-emerald-300/80 uppercase">
                Live take
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-neutral-500">
              {titleFor(signal)}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 transition active:scale-90 hover:bg-white/15"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — streaming text */}
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {!text && !error && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Gwak is reading the room…
            </div>
          )}
          {error && (
            <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {text && (
            <div className="text-[15px] leading-relaxed text-neutral-200">
              <ReactMarkdown
                components={{
                  // Tighten default markdown spacing for a chat-message feel
                  // and keep colors on-brand.
                  p: ({ children }) => (
                    <p className="mb-3 last:mb-0">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-bold text-white">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-neutral-100">{children}</em>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-3 ml-4 list-disc space-y-1 marker:text-neutral-500">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-3 ml-4 list-decimal space-y-1 marker:text-neutral-500">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li>{children}</li>,
                  h1: ({ children }) => (
                    <h1 className="mt-4 mb-2 text-base font-bold text-white">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mt-4 mb-2 text-base font-bold text-white">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mt-3 mb-1.5 text-sm font-bold text-white">
                      {children}
                    </h3>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-emerald-200">
                      {children}
                    </code>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-3 border-l-2 border-emerald-400/40 pl-3 text-neutral-400">
                      {children}
                    </blockquote>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-2 hover:decoration-emerald-300/80"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {text}
              </ReactMarkdown>
              {!done && (
                <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[2px] animate-pulse bg-emerald-300 align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-none border-t border-white/5 px-5 py-3 text-center text-[10px] tracking-wider text-neutral-600 uppercase">
          Not financial advice · {done ? "Done" : "Streaming"}
        </div>
      </div>
    </div>
  );
}
