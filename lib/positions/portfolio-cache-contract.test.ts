import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("portfolio cache architecture contract", () => {
  it("defines a portfolio snapshot table for cache-first rendering", () => {
    const schema = readFileSync("lib/db/schema.ts", "utf8");

    expect(schema).toContain("portfolio_snapshots");
    expect(schema).toContain("portfolioSnapshots");
    expect(schema).toContain("payload");
    expect(schema).toContain("summary");
    expect(schema).toContain("stale_reason");
  });

  it("has a DB-only snapshot route that does not import live exchange clients", () => {
    const route = readFileSync("app/api/portfolio/snapshot/route.ts", "utf8");

    expect(route).toContain("loadPortfolioSnapshotForUser");
    expect(route).not.toContain("@/lib/pacifica/client");
    expect(route).not.toContain("@/lib/flash/perps");
    expect(route).not.toContain("@/lib/data/marks");
    expect(route).not.toContain("@/lib/solana/balance");
  });

  it("has a refresh route used for live background refreshes", () => {
    const route = readFileSync("app/api/portfolio/refresh/route.ts", "utf8");

    expect(route).toContain("POST");
    expect(route).toContain("@/app/api/portfolio/route");
  });

  it("portfolio page renders snapshots before background refreshes", () => {
    const page = readFileSync("app/(app)/portfolio/page.tsx", "utf8");

    expect(page).toContain('"/api/portfolio/snapshot"');
    expect(page).toContain('"/api/portfolio/refresh"');
    expect(page).toContain("setSnapshotMeta");
    expect(page).not.toContain("const POLL_MS = 3000");
  });
});
