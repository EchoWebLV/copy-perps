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
}

/** Display metadata keyed by on-chain persona name. */
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
