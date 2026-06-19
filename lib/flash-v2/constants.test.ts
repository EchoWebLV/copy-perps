// lib/flash-v2/constants.test.ts
import { describe, expect, it } from "vitest";
import { resolveProgramId, resolveErRpc, FLASH_V2_REST_BASE, USDC_MINT } from "./constants";

describe("flash-v2 constants", () => {
  it("resolves the mainnet program id", () => {
    expect(resolveProgramId("mainnet")).toBe("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");
  });
  it("resolves the devnet program id", () => {
    expect(resolveProgramId("devnet")).toBe("FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj");
  });
  it("defaults the ER rpc for devnet", () => {
    expect(resolveErRpc("devnet")).toContain("magicblock.app");
  });
  it("exposes the public REST base and USDC mint", () => {
    expect(FLASH_V2_REST_BASE).toBe("https://flashapi.trade/v2");
    expect(USDC_MINT).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});
