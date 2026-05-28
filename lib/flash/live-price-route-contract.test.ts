import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash live price stream route contract", () => {
  it("proxies Pyth Hermes SSE with optional API key auth", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/flash/perp/prices/stream/route.ts"),
      "utf8",
    );

    expect(source).toContain("buildPythHermesStreamUrl");
    expect(source).toContain("PYTH_HERMES_API_KEY");
    expect(source).toContain("PYTH_API_KEY");
    expect(source).toContain("text/event-stream");
    expect(source).toContain("return new Response(upstream.body");
  });
});
