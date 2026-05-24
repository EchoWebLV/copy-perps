import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WhalePulseFeed route contract", () => {
  it("uses Pulse instead of the old Chatter analysis stream on the whale social route", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "app/(app)/chatter/page.tsx"),
      "utf8",
    );

    expect(routeSource).toContain("WhalePulseFeed");
    expect(routeSource).not.toContain("WhaleAnalysisStream");
  });

  it("renders compact social tape affordances instead of large analysis blocks", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("PULSE");
    expect(componentSource).toContain("Watching");
    expect(componentSource).toContain("Bullish");
    expect(componentSource).toContain("Fading");
    expect(componentSource).toContain("buildPulseItems");
    expect(componentSource).toContain("TailModal");
    expect(componentSource).not.toContain("SUMMARY");
    expect(componentSource).not.toContain("THESIS");
    expect(componentSource).not.toContain("RISK");
  });
});
