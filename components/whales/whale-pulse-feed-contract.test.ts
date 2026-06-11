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
    expect(routeSource).toContain("buildWhalePositionSignals(1000)");
    expect(routeSource).toContain('<AppShell railTitle="Pulse" hideEmptyRail>');
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
    expect(componentSource).not.toContain("<CommentsButton");
    expect(componentSource).toContain("buildPulseItems");
    expect(componentSource).toContain('/api/whales/live?limit=1000');
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

  it("keeps the mobile snap feed and adds a desktop pulse grid", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("snap-y snap-mandatory overflow-y-scroll");
    expect(componentSource).toContain('scrollSnapStop: "always"');
    expect(componentSource).toContain("h-full w-full snap-start");
    expect(componentSource).toContain("lg:hidden");
    expect(componentSource).toContain("hidden h-full min-h-0 flex-col lg:flex");
    expect(componentSource).toContain("PulsePositionCard");
    expect(componentSource).toContain("DesktopPulseCard");
    expect(componentSource).toContain("xl:grid-cols-3");
    expect(componentSource).toContain("PULSE TAPE");
    expect(componentSource).toContain("DesktopPulseReactionButton");
    expect(componentSource).toContain("inline-flex w-auto");
    expect(componentSource).not.toContain('<ul className="divide-y"');
  });

  it("adds whale-level 1D win rate and 30D P/L to Pulse cards", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("/api/whales/roster");
    expect(componentSource).toContain("statsByWhaleId");
    // Tiles render through availableMetrics so N/A stats are omitted
    // instead of shown as dead cells.
    expect(componentSource).toContain("function availableMetrics");
    expect(componentSource).toContain('label: "1D Win Rate"');
    expect(componentSource).toContain('label: "30D P/L"');
    expect(componentSource).toContain("formatWinRate");
    expect(componentSource).toContain("formatSignedUsd");
  });

  it("keeps the mobile reaction controls on one row", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("flex-nowrap");
    expect(componentSource).toContain("sm:flex-wrap");
    expect(componentSource).toContain('className="shrink-0"');
  });

  it("keeps extra space between reactions and the Tail button", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain(
      "mt-auto flex flex-col gap-4 pt-4 sm:flex-row",
    );
  });

  it("hides comments for now and keeps reaction icons visible on all viewports", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).not.toContain("<CommentsButton");
    expect(componentSource).not.toContain("<CommentsPanel");
    expect(componentSource).not.toContain("function CommentsButton");
    expect(componentSource).not.toContain("function CommentsPanel");
    expect(componentSource).not.toContain('className="hidden sm:inline"');
  });

  it("does not render time-sensitive age labels with Date.now during hydration", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("useState(0)");
    expect(componentSource).not.toContain("useState(() => Date.now())");
  });

  it("labels source freshness as live instead of fresh so old holdings do not read as new opens", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    // Staleness reads as a data-freshness note (amber), not a dead trade
    // (red): "Mark delayed" vs "Live".
    expect(componentSource).toContain('{p.stale ? "Mark delayed" : "Live"}');
    expect(componentSource).not.toContain('{p.stale ? "Stale" : "Fresh"}');
  });

  it("retains recent Pulse cards when a live-position poll returns a partial list", () => {
    const componentSource = readFileSync(
      join(process.cwd(), "components/whales/WhalePulseFeed.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("mergePulsePositionSignals");
    expect(componentSource).toContain("setPositions((current)");
    expect(componentSource).toContain(
      "mergePulsePositionSignals(current, data.positions, Date.now())",
    );
  });
});
