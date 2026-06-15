// lib/arena/personas.ts
//
// Display registry + PDA derivation for the on-chain arena bots.
//
// The persona-id encoding MUST stay byte-identical to scripts/arena/
// init-devnet.ts `personaId()`: utf8 bytes zero-padded (or truncated) to 16.
// Those exact bytes are the bot PDA seed, so the string IS the on-chain
// identity (PINS.md Task 13 — devnet personas use dashes: scalper-v1 /
// rider-v1; the dot-variants in the local Rust suites are different PDAs).
//
// @solana/web3.js only — no @coral-xyz/anchor anywhere in the app bundle.
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export interface ArenaPersona {
  display: string;
  emoji: string;
  blurb: string;
  /** Optional avatar image (public/ path). When set, the UI shows it instead
   *  of the emoji — the LLM bots use the gwak frog avatars. */
  image?: string;
}

/** Display metadata keyed by on-chain persona name.
 *  v2 personas are the live roster on market 1 — fresh accounts stood up to
 *  sidestep the wedged v1 delegations (PINS.md 2026-06-12 incident). Same
 *  strategies and display names; only the on-chain identity differs. */
export const ARENA_PERSONAS: Record<string, ArenaPersona> = {
  "scalper-v1": {
    display: "Scalper",
    emoji: "⚡",
    blurb: "15s momentum, 100x",
  },
  "rider-v1": {
    display: "Trend Rider",
    emoji: "🏄",
    blurb: "1m trend rider, 20x",
  },
  "scalper-v2": {
    display: "Scalper",
    emoji: "⚡",
    blurb: "15s momentum, 100x",
  },
  "rider-v2": {
    display: "Trend Rider",
    emoji: "🏄",
    blurb: "1m trend rider, 20x",
  },
  "berserker-v1": {
    display: "Berserker",
    emoji: "🪓",
    blurb: "hair-trigger scalps, 25x",
  },
  "degen-v1": {
    display: "Degen",
    emoji: "🎰",
    blurb: "trades every wiggle, 50x",
  },
  // LLM oracle bots — off-chain brain, on-chain decisions via apply_decision.
  // Named by the actual model; gwak frog avatars (public/bots/frog-*.png).
  "claude-v1": {
    display: "Opus 4.8",
    emoji: "🧠",
    blurb: "Anthropic · Claude Opus 4.8",
    image: "/bots/frog-claude.png",
  },
  "grok-v1": {
    display: "Grok 4.3",
    emoji: "🤖",
    blurb: "xAI · Grok 4.3",
    image: "/bots/frog-grok.png",
  },
  "gpt-v1": {
    display: "GPT-5",
    emoji: "🟢",
    blurb: "OpenAI · GPT-5",
    image: "/bots/frog-gpt.png",
  },
};

/** utf8 bytes zero-padded/truncated to 16 — identical to init-devnet.ts
 *  `personaId()` (Buffer.write never splits a multi-byte char at the cap). */
export function personaIdBytes(name: string): Uint8Array {
  const buf = Buffer.alloc(16);
  buf.write(name, "utf8");
  return buf;
}

/** Bot PDA: seeds ["bot", personaIdBytes(name)] under the arena program. */
export function botPda(name: string, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), personaIdBytes(name)],
    programId,
  )[0];
}

/** LlmBot PDA: seeds ["llmbot", personaIdBytes(name)] — the oracle-bot tier. */
export function llmBotPda(name: string, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("llmbot"), personaIdBytes(name)],
    programId,
  )[0];
}
