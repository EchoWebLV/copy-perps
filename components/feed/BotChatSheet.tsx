"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { X, Send } from "lucide-react";

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

interface Props {
  botId: string;
  botName: string;
  avatarEmoji: string;
  avatarImageUrl?: string | null;
  // Latest open narrations from the bot's current positions — shown as a
  // sticky "what the bot is thinking" block above the chat history.
  openingThoughts: Array<{ asset: string; side: "long" | "short"; narration: string | null }>;
  onClose: () => void;
}

export function BotChatSheet({
  botId,
  botName,
  avatarEmoji,
  avatarImageUrl,
  openingThoughts,
  onClose,
}: Props) {
  const { authenticated, getAccessToken } = usePrivy();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load history on open.
  useEffect(() => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");
        const resp = await fetch(`/api/bots/${botId}/chat`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as { messages: ChatMessage[] };
        if (!cancelled) setMessages(data.messages ?? []);
      } catch (err) {
        if (!cancelled) setError(String(err).slice(0, 100));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, botId, getAccessToken]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch(`/api/bots/${botId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
      });
      if (!resp.ok) {
        const e = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { reply: string };
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setError(String(err).slice(0, 140));
      // Roll back the optimistic insert so the user can retry.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:items-center lg:justify-center"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-white/10 bg-neutral-950 shadow-2xl lg:mx-auto lg:max-w-[520px] lg:rounded-3xl lg:border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3">
          <div className="flex items-center gap-3">
            {avatarImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarImageUrl}
                alt=""
                className="h-10 w-10 rounded-full object-cover ring-1 ring-white/15"
                draggable={false}
              />
            ) : (
              <span className="text-3xl leading-none">{avatarEmoji}</span>
            )}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                Chat with
              </div>
              <div className="text-base font-bold">{botName}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/5 p-2 text-white/60 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>

        {/* Bot's current thoughts (sticky context strip) */}
        {openingThoughts.length > 0 && (
          <div className="border-y border-white/5 bg-black/40 px-5 py-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Currently thinking
            </div>
            <div className="space-y-1.5">
              {openingThoughts.map((t, i) =>
                t.narration ? (
                  <p
                    key={i}
                    className="text-[12px] italic leading-snug text-white/80"
                  >
                    <span
                      className={`mr-1.5 rounded px-1 py-px text-[9px] font-bold uppercase ${
                        t.side === "long"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-rose-500/20 text-rose-200"
                      }`}
                    >
                      {t.side} {t.asset}
                    </span>
                    &ldquo;{t.narration}&rdquo;
                  </p>
                ) : null,
              )}
            </div>
          </div>
        )}

        {/* Scrollable message history */}
        <div
          ref={scrollRef}
          className="min-h-[180px] flex-1 overflow-y-auto px-5 py-4"
        >
          {loading && (
            <div className="text-center text-xs text-white/40">
              Loading conversation…
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="px-2 text-center text-xs text-white/40">
              {authenticated
                ? `Ask ${botName} anything — why it took a trade, what it sees in the market, what's next.`
                : `Sign in to chat with ${botName}.`}
            </div>
          )}
          <div className="space-y-2.5">
            {messages.map((m, i) => (
              <div
                key={m.id ?? i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                    m.role === "user"
                      ? "bg-white text-black"
                      : "bg-white/8 text-white ring-1 ring-white/10"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white/8 px-3 py-2 text-[13px] text-white/60 ring-1 ring-white/10">
                  <span className="animate-pulse">thinking…</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-5 pb-2 text-center text-[11px] text-rose-300">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-white/5 bg-black/50 px-3 py-3 pb-[env(safe-area-inset-bottom)]">
          {authenticated ? (
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Ask ${botName}…`}
                disabled={sending}
                className="flex-1 resize-none rounded-2xl bg-white/8 px-3 py-2 text-[14px] text-white placeholder:text-white/30 outline-none ring-1 ring-white/10 focus:ring-white/30 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || sending}
                className="rounded-2xl bg-white p-2.5 text-black transition active:scale-95 disabled:opacity-40"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/8 px-3 py-3 text-center text-[12px] text-white/60 ring-1 ring-white/10">
              Sign in to chat with {botName}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
