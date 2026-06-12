import { describe, expect, it } from "vitest";
import { isDevnetEndpoint, solscanAccountUrl } from "./solscan";

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
