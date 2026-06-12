import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOracleFresh, ORACLE_FRESH_MS } from "./OracleLiveBadge";

describe("isOracleFresh", () => {
  it("never-delivered is not fresh", () => {
    expect(isOracleFresh(0, 5_000)).toBe(false);
  });

  it("fresh within the window, stale past it (boundary inclusive)", () => {
    expect(isOracleFresh(1_000, 1_000 + ORACLE_FRESH_MS)).toBe(true);
    expect(isOracleFresh(1_000, 1_000 + ORACLE_FRESH_MS + 1)).toBe(false);
  });
});

describe("badge wiring contract", () => {
  it("mounts inside the live graph container", () => {
    const source = readFileSync(
      join(process.cwd(), "components/trade/FastPerpsGame.tsx"),
      "utf8",
    );
    expect(source).toContain("<OracleLiveBadge />");
    expect(source).toContain('ref={containerRef} className="relative h-full w-full"');
  });

  it("claims live only on ER delivery, never for the SSE fallback", () => {
    const source = readFileSync(
      join(process.cwd(), "components/trade/OracleLiveBadge.tsx"),
      "utf8",
    );
    expect(source).toContain("useFlashOracleDeliveryMs");
    expect(source).toContain("return null");
  });
});
