// lib/flash-v2/constants.test.ts
import { describe, expect, it } from "vitest";
import {
  resolveProgramId,
  resolveErRpc,
  FLASH_V2_REST_BASE,
  USDC_MINT,
  KEYSP_PROGRAM_ID,
  SESSION_TOKEN_V2_SEED,
  MAX_SESSION_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_TOPUP_LAMPORTS,
} from "./constants";

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
  it("exposes the session-key constants with a load-bearing v2 seed", () => {
    expect(KEYSP_PROGRAM_ID).toBe("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
    expect(SESSION_TOKEN_V2_SEED).toBe("session_token_v2");
    expect(SESSION_TOPUP_LAMPORTS).toBe(10_000_000);
  });
  it("keeps the default session TTL under the on-chain 7-day cap", () => {
    expect(DEFAULT_SESSION_TTL_SECONDS).toBeLessThan(MAX_SESSION_TTL_SECONDS);
    expect(MAX_SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});
