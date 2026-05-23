import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readComponent(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Whale fingerprint avatar contract", () => {
  it("uses source-account fingerprints in whale roster cards", () => {
    const source = readComponent("components/whales/WhaleRoster.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={p.sourceAccount}");
    expect(source).not.toContain("imageUrl={p.avatarUrl}");
  });

  it("uses source-account fingerprints in live position cards", () => {
    const source = readComponent("components/whales/WhaleLiveFeed.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={p.sourceAccount}");
    expect(source).not.toContain("imageUrl={p.avatarUrl}");
  });

  it("uses source-account fingerprints in chatter analysis rows", () => {
    const source = readComponent("components/whales/WhaleAnalysisStream.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={p.sourceAccount}");
    expect(source).not.toContain("imageUrl={p.avatarUrl}");
  });

  it("uses the same whale fingerprint in the tail modal header", () => {
    const source = readComponent("components/tail/TailModal.tsx");

    expect(source).toContain("WhaleFingerprintAvatar");
    expect(source).toContain("sourceAccount={source.sourceAccount}");
    expect(source).toContain('source.kind === "whale"');
  });
});
