// lib/bots/chat.ts
//
// Per-user, per-bot chat. The user types a question; we hand the bot's
// persona + a snapshot of its current positions + the recent conversation
// history to xAI, and return a short in-character reply.
//
// The auto-narration on opens/closes (lib/bots/narrator.ts) is the bot's
// public broadcast — visible on cards and the Chatter feed. This module
// is the private back-and-forth that lives in the bot_chats table.

import { PERSONAS } from "./narrator";
import { generateXaiTextFromMessages } from "@/lib/xai/responses";

const MAX_OUTPUT_TOKENS = 250;
const CHAT_TIMEOUT_MS = 8_000;

export interface ChatPosition {
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
  stakePnlPct: number;
  stakeUsd: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatArgs {
  personaKey: string;
  positions: ChatPosition[];
  history: ChatMessage[];
  userMessage: string;
  bankrollUsd: number;
}

function snippet(p: ChatPosition): string {
  const pnl = (p.stakePnlPct * 100).toFixed(1);
  const sign = p.stakePnlPct >= 0 ? "+" : "";
  return `${p.side.toUpperCase()} ${p.asset} ${p.leverage}x @ ${p.entryMark.toFixed(2)} → ${p.currentMark.toFixed(2)} (${sign}${pnl}% on stake, $${p.stakeUsd.toFixed(0)})`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`chat timeout ${ms}ms`)), ms),
    ),
  ]);
}

export async function chatWithBot(args: ChatArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey as keyof typeof PERSONAS];
  if (!persona) throw new Error(`unknown persona ${args.personaKey}`);

  const positionsBlock =
    args.positions.length === 0
      ? "You currently hold no positions — watching the tape."
      : "Your current open positions:\n" +
        args.positions.map((p) => "- " + snippet(p)).join("\n");

  const systemPrompt = `${persona.systemPrompt}

${positionsBlock}
Paper bankroll: $${args.bankrollUsd.toFixed(0)}.

Chat rules:
- 1-3 short sentences max. Stay fully in character.
- You can reference your open positions, strategy, or the market.
- This is paper trading. Never give actual financial advice.
- If you don't have the data to answer, say so briefly in character.
- Plain text only. No markdown. No quotes around your reply.`;

  const messages = [
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: args.userMessage },
  ];

  const text = await withTimeout(
    generateXaiTextFromMessages({
      systemPrompt,
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }),
    CHAT_TIMEOUT_MS,
  );
  return text.trim();
}
