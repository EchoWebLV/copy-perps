// lib/arena/llm/submit.ts
//
// Builds the operator-signed apply_decision instruction for an LlmBot. Pure
// instruction construction (no Connection) so it is fully unit-testable; the
// brain loop signs + sends it to the ER. Uses only @solana/web3.js + manual
// Borsh/discriminator encoding (no @coral-xyz/anchor dependency) — the program
// is the authority, this just packs the bytes the IDL expects.
//
// SOURCE OF TRUTH for the arg order: arena-program lib.rs `apply_decision`
//   (market_id u8, action u8, side u8, leverage u16, stake_frac_bps u16,
//    stop_bps u16, tp_bps u16, confidence u8)
// and the ApplyDecision accounts (config, feed, llm_bot, operator).

import { createHash } from "node:crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { ApplyDecisionArgs } from "./floor";

export const CONFIG_SEED = "config";
export const LLM_BOT_SEED = "llmbot";

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
export function ixDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

/** 16-byte persona id seed (utf8, zero-padded) — matches scripts/arena. */
export function personaIdBytes(name: string): Buffer {
  const b = Buffer.alloc(16);
  b.write(name, "utf8");
  return b;
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId)[0];
}

export function llmBotPda(programId: PublicKey, persona: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LLM_BOT_SEED), personaIdBytes(persona)],
    programId,
  )[0];
}

/** Borsh-encode the apply_decision instruction data (discriminator + 12 arg bytes). */
export function encodeApplyDecisionData(marketId: number, args: ApplyDecisionArgs): Buffer {
  const body = Buffer.alloc(12);
  let o = 0;
  body.writeUInt8(marketId & 0xff, o); o += 1;
  body.writeUInt8(args.action & 0xff, o); o += 1;
  body.writeUInt8(args.side & 0xff, o); o += 1;
  body.writeUInt16LE(args.leverage & 0xffff, o); o += 2;
  body.writeUInt16LE(args.stakeFracBps & 0xffff, o); o += 2;
  body.writeUInt16LE(args.stopBps & 0xffff, o); o += 2;
  body.writeUInt16LE(args.tpBps & 0xffff, o); o += 2;
  body.writeUInt8(args.confidence & 0xff, o); o += 1;
  return Buffer.concat([ixDiscriminator("apply_decision"), body]);
}

export interface BuildApplyDecisionParams {
  programId: PublicKey;
  persona: string;
  operator: PublicKey;
  feed: PublicKey;
  marketId: number;
  args: ApplyDecisionArgs;
}

/** Build the operator-signed apply_decision instruction. */
export function buildApplyDecisionIx(p: BuildApplyDecisionParams): TransactionInstruction {
  const keys = [
    { pubkey: configPda(p.programId), isSigner: false, isWritable: false },
    { pubkey: p.feed, isSigner: false, isWritable: false },
    { pubkey: llmBotPda(p.programId, p.persona), isSigner: false, isWritable: true },
    { pubkey: p.operator, isSigner: true, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: p.programId,
    keys,
    data: encodeApplyDecisionData(p.marketId, p.args),
  });
}
