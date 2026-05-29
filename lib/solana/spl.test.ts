import { Keypair, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "./spl";

describe("SPL token helpers", () => {
  it("builds an idempotent associated token account instruction", () => {
    const payer = Keypair.generate().publicKey;
    const associatedToken = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;

    const ix = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      associatedToken,
      owner,
      mint,
    );

    expect(ix.programId).toEqual(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(ix.data).toEqual(Buffer.from([1]));
    expect(ix.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("builds a transfer checked instruction", () => {
    const source = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;

    const ix = createTransferCheckedInstruction(
      source,
      mint,
      destination,
      owner,
      123_456_789n,
      6,
    );

    expect(ix.programId).toEqual(TOKEN_PROGRAM_ID);
    expect(ix.data.toString("hex")).toBe("0c15cd5b070000000006");
    expect(ix.keys).toEqual([
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ]);
  });
});
