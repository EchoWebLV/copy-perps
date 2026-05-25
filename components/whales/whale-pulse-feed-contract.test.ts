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
    const socialSource = readFileSync(
      join(process.cwd(), "components/whales/pulse-social.ts"),
      "utf8",
    );

    expect(componentSource).toContain("PULSE");
    expect(socialSource).toContain("Tailing");
    expect(socialSource).toContain("Bullish");
    expect(socialSource).toContain("Bearish");
    expect(componentSource).toContain("Comments");
    expect(componentSource).toContain("buildPulseItems");
    expect(componentSource).toContain("/api/pulse/social");
    expect(componentSource).toContain("getAccessToken");
    expect(componentSource).toContain("login");
    expect(componentSource).toContain("authenticated");
    expect(componentSource).toContain("requirePulseAuth");
    expect(componentSource).toContain("TailModal");
    expect(componentSource).toContain("recentReactors");
    expect(componentSource).toContain("CommentAvatar");
    expect(componentSource).not.toContain("buildPulseSeedComments");
    expect(componentSource).not.toContain("buildPulseSocialStats");
    expect(componentSource).not.toContain("localComments");
    expect(componentSource).not.toContain("setLocalComments");
    expect(componentSource).not.toContain("Record<string, PulseReaction | undefined>");
    expect(socialSource).not.toContain("TapeReader");
    expect(socialSource).not.toContain("RiskDesk");
    expect(socialSource).not.toContain("buildPulseSeedComments");
    expect(socialSource).not.toContain("buildPulseSocialStats");
    expect(componentSource).not.toContain("SUMMARY");
    expect(componentSource).not.toContain("THESIS");
    expect(componentSource).not.toContain("RISK");
  });

  it("keeps the mobile reaction controls on one row", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("flex-nowrap");
    expect(componentSource).toContain("sm:flex-wrap");
    expect(componentSource).toContain("sm:inline");
  });
});
