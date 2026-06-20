import { describe, expect, it } from "vitest";
import {
  isDevnetEndpoint,
  magicblockExplorerAccountUrl,
  magicblockExplorerTxUrl,
  solscanAccountUrl,
} from "./solscan";

describe("cluster-aware Solscan links", () => {
  it("devnet endpoints get the cluster param", () => {
    expect(isDevnetEndpoint("https://devnet.magicblock.app")).toBe(true);
    expect(solscanAccountUrl("Abc123", "https://devnet.magicblock.app")).toBe(
      "https://solscan.io/account/Abc123?cluster=devnet",
    );
  });

  it("mainnet ER endpoints link to mainnet Solscan (no param)", () => {
    expect(isDevnetEndpoint("https://eu.magicblock.app")).toBe(false);
    expect(solscanAccountUrl("Abc123", "https://eu.magicblock.app")).toBe(
      "https://solscan.io/account/Abc123",
    );
  });

  it("missing endpoint fails toward mainnet (the live default)", () => {
    expect(solscanAccountUrl("Abc123", undefined)).toBe(
      "https://solscan.io/account/Abc123",
    );
  });
});

describe("MagicBlock ER explorer links (Solana Explorer over the rollup RPC)", () => {
  it("points the account view at the ER via the custom-RPC param", () => {
    expect(magicblockExplorerAccountUrl("BotPda", "https://eu.magicblock.app")).toBe(
      "https://explorer.solana.com/address/BotPda?cluster=custom&customUrl=https%3A%2F%2Feu.magicblock.app",
    );
  });

  it("links a single on-rollup tx (one bot movement)", () => {
    expect(magicblockExplorerTxUrl("SigAbc", "https://devnet.magicblock.app")).toBe(
      "https://explorer.solana.com/tx/SigAbc?cluster=custom&customUrl=https%3A%2F%2Fdevnet.magicblock.app",
    );
  });

  it("falls back to the live mainnet ER when no endpoint is passed", () => {
    expect(magicblockExplorerAccountUrl("BotPda", undefined)).toContain(
      encodeURIComponent("https://eu.magicblock.app"),
    );
  });
});
