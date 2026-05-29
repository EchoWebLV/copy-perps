import { afterEach, describe, expect, it, vi } from "vitest";

const originalWarn = console.warn;

afterEach(() => {
  console.warn = originalWarn;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("suppressKnownRuntimeWarnings", () => {
  it("suppresses the bigint-buffer native binding fallback warning", async () => {
    const warn = vi.fn();
    console.warn = warn;
    const { suppressKnownRuntimeWarnings } = await import("./console-noise");

    suppressKnownRuntimeWarnings();
    console.warn(
      "bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)",
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("passes through other warnings", async () => {
    const warn = vi.fn();
    console.warn = warn;
    const { suppressKnownRuntimeWarnings } = await import("./console-noise");

    suppressKnownRuntimeWarnings();
    console.warn("[other] warning", { ok: false });

    expect(warn).toHaveBeenCalledWith("[other] warning", { ok: false });
  });
});
