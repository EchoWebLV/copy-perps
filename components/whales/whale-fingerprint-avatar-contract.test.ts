import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readComponent(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Whale fingerprint avatar contract", () => {
  it("renders a literal crisp 16 by 16 SVG code without decorative layers", () => {
    const source = readComponent("components/whales/WhaleFingerprintAvatar.tsx");

    expect(source).toContain("WHALE_FINGERPRINT_GRID_SIZE");
    expect(source).toContain('shapeRendering="crispEdges"');
    expect(source).not.toContain("<circle");
    expect(source).not.toContain("<path");
    expect(source).not.toContain("conic-gradient");
  });

  it("falls back to source-account fingerprints in unified feed cards", () => {
    const source = readComponent("components/feed/UnifiedFeed.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={p.sourceAccount}");
    // avatarUrl renders as a plain <img> when curated; the fingerprint is
    // the fallback identity, never a StoryAvatar imageUrl.
    expect(source).not.toContain("imageUrl={p.avatarUrl}");
  });

  it("uses the same whale fingerprint in the tail modal header", () => {
    const source = readComponent("components/tail/TailModal.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={source.sourceAccount}");
    expect(source).toContain('source.kind === "whale"');
  });
});
