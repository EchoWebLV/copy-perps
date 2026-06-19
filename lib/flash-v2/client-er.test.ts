import { afterEach, describe, expect, it, vi } from "vitest";
import { flashV2ErRpc } from "./client-er";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("flashV2ErRpc", () => {
  it("prefers the dedicated NEXT_PUBLIC_FLASH_V2_ER_RPC", () => {
    vi.stubEnv("NEXT_PUBLIC_FLASH_V2_ER_RPC", "https://flash.er.example");
    vi.stubEnv("NEXT_PUBLIC_ARENA_ER_ENDPOINT", "https://arena.er.example");
    expect(flashV2ErRpc()).toBe("https://flash.er.example");
  });

  it("falls back to the arena ER endpoint (same MagicBlock rollup)", () => {
    vi.stubEnv("NEXT_PUBLIC_FLASH_V2_ER_RPC", "");
    vi.stubEnv("NEXT_PUBLIC_ARENA_ER_ENDPOINT", "https://arena.er.example");
    expect(flashV2ErRpc()).toBe("https://arena.er.example");
  });

  it("falls back to the mainnet default when neither env is set", () => {
    vi.stubEnv("NEXT_PUBLIC_FLASH_V2_ER_RPC", "");
    vi.stubEnv("NEXT_PUBLIC_ARENA_ER_ENDPOINT", "");
    expect(flashV2ErRpc()).toBe("https://mainnet.magicblock.app");
  });
});
