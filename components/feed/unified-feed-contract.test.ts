import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const FEED = "components/feed/UnifiedFeed.tsx";

describe("UnifiedFeed contract", () => {
  it("replaces the TikTok snap UI with stacked cards", () => {
    const source = read(FEED);

    expect(source).not.toContain("snap-y");
    expect(source).not.toContain("snap-mandatory");
    expect(source).not.toContain("snap-start");
    expect(source).not.toContain("scrollSnapStop");
    expect(source).toContain("flex w-full max-w-xl flex-col gap-3");
  });

  it("drops heat completely: no heat sort, no /live links, no view switch", () => {
    const source = read(FEED);

    expect(source).not.toContain("heatScore");
    expect(source).not.toContain('"Hot"');
    expect(source).not.toContain("/live");
    expect(source).not.toContain("WhaleViewSwitch");
  });

  it("filters by entity pills and sorts via one compact control, defaulting to 1D", () => {
    const source = read(FEED);

    expect(source).toContain("FEED_ENTITY_OPTIONS");
    expect(source).toContain("FEED_SORT_OPTIONS");
    expect(source).toContain('useState<FeedEntityFilter>("all")');
    expect(source).toContain('useState<FeedSortKey>("pnl1d")');
    expect(source).toContain('aria-label="Filter feed"');
    expect(source).toContain('aria-label="Sort feed"');
  });

  it("keeps the existing whale tail flow and stale-refresh data plumbing", () => {
    const source = read(FEED);

    expect(source).toContain("buildWhaleTailSource");
    expect(source).toContain("TailModal");
    expect(source).toContain('fetch("/api/whales/roster"');
    expect(source).toContain("shouldUseRosterRefresh");
    expect(source).toContain("const POLL_MS = 30_000;");
    expect(source).toContain("setLoaded(true)");
  });

  it("feeds bot cards from the arena live hook with a staleness-gated copy CTA", () => {
    const source = read(FEED);

    expect(source).toContain("useArenaLive");
    expect(source).toContain("ARENA_PERSONAS");
    // "Copy — soon" is gone: fresh bots get the real Tail button into the
    // shared TailModal; frozen data degrades to an honest disabled label.
    expect(source).not.toContain("Copy — soon");
    expect(source).toContain("botCopyCta");
    expect(source).toContain('"Copy — stale"');
    expect(source).toContain("botPositionPnlPct");
    expect(source).toContain("market.lastPrice");
  });

  it("wires bot tails through the same shared TailModal as whales (both renderings)", () => {
    const source = read(FEED);

    // Stacked card and desktop grid both hand a built bot TailSource to the
    // single setTailSource → TailModal instance.
    expect(source).toContain('from "./bot-tail-source"');
    expect(source).toContain("BotTailCta");
    expect(source).toContain("GridBotCard");
    expect(source).toContain("tailCta=");
  });

  it("renders W/L counts only for bots — whale payloads carry no win rate", () => {
    const source = read(FEED);

    // The W/L squares live in the bot card; the whale card renders P&L only
    // (winRatePct1d is null from every whale stats path, so reading it would
    // mean inventing data).
    expect(source).toContain("WinLossSquare");
    expect(source).toContain("bot.trades - bot.wins");
    expect(source).not.toContain("stats.winRatePct1d");
  });

  it("shows a flat line instead of a position card when nothing is open", () => {
    const source = read(FEED);

    expect(source).toContain("flat — no open positions");
    expect(source).toContain("New position · opened");
  });
});

describe("desktop card grid (founder feedback: classic cards return at lg+)", () => {
  it("renders the same ranked entries twice: stacked below lg, grid at lg+", () => {
    const source = read(FEED);

    // The stacked Invo list hides at lg; the classic grid sibling takes over.
    expect(source).toContain("flex w-full max-w-xl flex-col gap-3 lg:hidden");
    expect(source).toContain("lg:grid");
    expect(source).toContain("grid-cols-2");
    expect(source).toContain("xl:grid-cols-3");
    expect(source).toContain("max-w-6xl");
  });

  it("reuses the arena BotCard and the resurrected DesktopWhaleCard", () => {
    const source = read(FEED);

    expect(source).toContain('from "@/components/arena/BotCard"');
    expect(source).toContain('from "./DesktopWhaleCard"');
  });

  it("keeps the resurrected desktop card free of heat and tape surfaces", () => {
    const card = read("components/feed/DesktopWhaleCard.tsx");

    expect(card).not.toContain("heatScore");
    expect(card).not.toContain("/live");
    expect(card).not.toContain("WhaleViewSwitch");
    // Tail keeps working from the grid: the same source builder the stacked
    // cards hand to TailModal.
    expect(card).toContain("buildWhaleTailSource");
  });
});

describe("dead surfaces stay dead", () => {
  it("removed the /live route, the tape, the heatmap and the old roster", () => {
    for (const gone of [
      "app/(app)/live/page.tsx",
      "components/whales/WhaleRoster.tsx",
      "components/whales/WhaleLiveFeed.tsx",
      "components/whales/WhaleMarketHeatmap.tsx",
      "components/whales/WhaleViewSwitch.tsx",
      "components/feed/LiveEntryChart.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), gone)), `${gone} should be deleted`)
        .toBe(false);
    }
  });

  it("keeps every shell nav link off /live", () => {
    expect(read("components/shell/nav-items.ts")).not.toContain("/live");
    expect(read("components/shell/BottomNav.tsx")).not.toContain("/live");
  });
});

describe("search survives leaving + returning to Traders", () => {
  it("persists the query to sessionStorage and restores it on mount", () => {
    const source = read(FEED);
    expect(source).toContain('FEED_SEARCH_KEY = "gwak:feed-search"');
    // Persist on user-driven change; clear removes it so it can't resurrect.
    expect(source).toContain("sessionStorage.setItem(FEED_SEARCH_KEY");
    expect(source).toContain("sessionStorage.removeItem(FEED_SEARCH_KEY)");
    // Restore on mount (a ?q= deep-link still wins).
    expect(source).toContain("sessionStorage.getItem(FEED_SEARCH_KEY)");
    // SearchBar + clear buttons go through the persisting setter.
    expect(source).toContain("onChange={setSearch}");
    expect(source).toContain('onClear={() => setSearch("")}');
  });
});
