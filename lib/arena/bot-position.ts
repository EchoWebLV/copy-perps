// lib/arena/bot-position.ts
//
// Server-side flat/active signal for an on-chain LLM arena bot, used by the
// mirror-close sweep to auto-close a Flash v2 bot tail once the bot it mirrors
// has fully exited. Reuses the audited byte decoder (decode.ts) and PDA
// derivation (personas.ts); reads the bot's `llmbot` PDA from the arena ER.
//
// POSITIVE-SIGNAL-ONLY: returns "flat" only when the bot account decodes cleanly
// with NO active position. Every other case — not an arena bot, missing config,
// RPC error, account absent, decode failure — returns "unknown" so the sweep
// never closes a tail it can't confirm has exited. (A flip long<->short keeps an
// active position, so it reads "active"; flip-mirroring is out of scope here.)
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeLlmBot, type ArenaLlmBot } from "./decode";
import { llmBotPda } from "./personas";

export type BotPositionSignal = "flat" | "active" | "unknown";

const ARENA_BOT_PREFIX = "arena:";

/** Persona id from a bot tail's `meta.botId` (`arena:<persona>`), or null if the
 *  botId isn't an on-chain arena bot (e.g. a paper-bot experiment id). */
export function personaFromBotId(botId: string): string | null {
  if (!botId.startsWith(ARENA_BOT_PREFIX)) return null;
  const persona = botId.slice(ARENA_BOT_PREFIX.length).trim();
  return persona.length > 0 ? persona : null;
}

export interface BotPositionDeps {
  /** Arena program id (base58); defaults to ARENA_PROGRAM_ID. */
  programId?: string;
  /** Arena ER endpoint; defaults to ARENA_ER_ENDPOINT. */
  endpoint?: string;
  /** Injectable account read (tests); defaults to a real ER getAccountInfo. */
  getAccountInfo?: (pubkey: PublicKey) => Promise<{ data: Uint8Array } | null>;
  /** Injectable decoder (tests); defaults to decodeLlmBot. */
  decode?: (data: Uint8Array) => ArenaLlmBot | null;
}

export async function getBotPositionSignal(
  botId: string,
  deps: BotPositionDeps = {},
): Promise<BotPositionSignal> {
  const persona = personaFromBotId(botId);
  if (!persona) return "unknown";

  const programIdStr = deps.programId ?? process.env.ARENA_PROGRAM_ID;
  if (!programIdStr) return "unknown";
  let programId: PublicKey;
  try {
    programId = new PublicKey(programIdStr);
  } catch {
    return "unknown";
  }

  const pda = llmBotPda(persona, programId);
  let info: { data: Uint8Array } | null;
  try {
    if (deps.getAccountInfo) {
      info = await deps.getAccountInfo(pda);
    } else {
      const endpoint = deps.endpoint ?? process.env.ARENA_ER_ENDPOINT;
      if (!endpoint) return "unknown";
      const acct = await new Connection(endpoint, "processed").getAccountInfo(pda);
      info = acct ? { data: acct.data } : null;
    }
  } catch {
    return "unknown";
  }
  if (!info?.data) return "unknown";

  const decode = deps.decode ?? decodeLlmBot;
  const bot = decode(info.data);
  if (!bot) return "unknown";
  return bot.positions.some((p) => p.active) ? "active" : "flat";
}
