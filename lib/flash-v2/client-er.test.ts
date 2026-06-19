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

  it("ignores the arena ER endpoint (arena ≠ Flash's ER node)", () => {
    // The arena runs on a different ER than Flash v2; falling back to it sent
    // trades to a node with a stale oracle (open fails 6006). No arena fallback.
    vi.stubEnv("NEXT_PUBLIC_FLASH_V2_ER_RPC", "");
    vi.stubEnv("NEXT_PUBLIC_ARENA_ER_ENDPOINT", "https://arena.er.example");
    expect(flashV2ErRpc()).toBe("https://flashtrade.magicblock.app");
  });

  it("falls back to Flash's dedicated ER node when the env is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_FLASH_V2_ER_RPC", "");
    expect(flashV2ErRpc()).toBe("https://flashtrade.magicblock.app");
  });
});
