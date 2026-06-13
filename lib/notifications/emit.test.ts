// lib/notifications/emit.test.ts
import { describe, expect, it } from "vitest";
import { buildEvent } from "./emit";

// ── fmtMoney boundary parity with the mock ───────────────────────────────
// Mock source of truth (docs/mockups/redesign-mock.html):
//   const fmt = n =>
//     (n<0?'-':'+') + '$' +
//     Math.abs(n).toLocaleString(undefined,{maximumFractionDigits: Math.abs(n)<100?2:0});
describe("fmtMoney boundary cases", () => {
  it("adds thousands separator for values ≥ 100: 1234.5 → +$1,235", () => {
    const e = buildEvent("auto-close", {
      userId: "u0",
      source: "X",
      market: "BTC",
      pnlUsd: 1234.5,
    });
    expect(e.title).toBe("Auto-close fired: +$1,235 on BTC");
  });

  it("drops trailing zeros above $100: 25 → +$25", () => {
    const e = buildEvent("auto-close", {
      userId: "u0",
      source: "X",
      market: "BTC",
      pnlUsd: 25,
    });
    expect(e.title).toBe("Auto-close fired: +$25 on BTC");
  });

  it("formats zero as +$0", () => {
    const e = buildEvent("auto-close", {
      userId: "u0",
      source: "X",
      market: "BTC",
      pnlUsd: 0,
    });
    expect(e.title).toBe("Auto-close fired: +$0 on BTC");
  });

  it("strips trailing zero on negative sub-100: -3.5 → -$3.5", () => {
    const e = buildEvent("auto-close", {
      userId: "u0",
      source: "X",
      market: "SOL",
      pnlUsd: -3.5,
    });
    expect(e.title).toBe("Auto-close fired: -$3.5 on SOL");
  });
});

describe("buildEvent", () => {
  // ── copy-opened ──────────────────────────────────────────────────────────
  it("formats a copy-opened event", () => {
    const e = buildEvent("copy-opened", {
      userId: "u1",
      source: "Iron Wolf",
      market: "ETH",
      side: "long",
      leverage: 20,
      stakeUsd: 10,
    });
    expect(e.userId).toBe("u1");
    expect(e.kind).toBe("copy-opened");
    expect(e.title).toBe("Copied Iron Wolf — ETH 20x long with $10");
    expect(e.body).toContain("Iron Wolf");
    expect(e.meta).toMatchObject({ source: "Iron Wolf", market: "ETH", stakeUsd: 10 });
  });

  it("formats copy-opened with large stake (0dp formatting)", () => {
    const e = buildEvent("copy-opened", {
      userId: "u2",
      source: "Bull Run",
      market: "BTC",
      side: "short",
      leverage: 5,
      stakeUsd: 150,
    });
    expect(e.title).toBe("Copied Bull Run — BTC 5x short with $150");
  });

  // ── auto-close ───────────────────────────────────────────────────────────
  it("formats an auto-close event with positive pnl", () => {
    const e = buildEvent("auto-close", {
      userId: "u1",
      source: "Iron Wolf",
      market: "ETH",
      pnlUsd: 1.92,
    });
    expect(e.kind).toBe("auto-close");
    expect(e.title).toBe("Auto-close fired: +$1.92 on ETH");
    expect(e.body).toContain("Iron Wolf exited");
  });

  it("formats an auto-close event with negative pnl", () => {
    const e = buildEvent("auto-close", {
      userId: "u1",
      source: "Iron Wolf",
      market: "SOL",
      pnlUsd: -3.5,
    });
    expect(e.title).toBe("Auto-close fired: -$3.5 on SOL");
    expect(e.body).toContain("Iron Wolf exited");
  });

  it("formats an auto-close event with undefined pnl", () => {
    const e = buildEvent("auto-close", {
      userId: "u1",
      source: "Iron Wolf",
      market: "ETH",
      pnlUsd: undefined,
    });
    expect(e.title).toBe("Auto-close fired on ETH");
    expect(e.body).toContain("Iron Wolf exited");
  });

  // ── copy-closed ──────────────────────────────────────────────────────────
  it("formats a copy-closed event", () => {
    const e = buildEvent("copy-closed", {
      userId: "u3",
      source: "Degen",
      market: "SOL",
    });
    expect(e.kind).toBe("copy-closed");
    expect(e.title).toBe("Copy closed: SOL");
    expect(e.body).toContain("Degen");
  });

  // ── source-closed ─────────────────────────────────────────────────────────
  it("formats a source-closed event", () => {
    const e = buildEvent("source-closed", {
      userId: "u4",
      source: "Whale X",
      market: "BTC",
    });
    expect(e.kind).toBe("source-closed");
    expect(e.title).toBe("Whale X closed BTC — your copy is detaching");
    expect(e.body).toContain("Whale X");
  });

  // ── autopilot-ended ──────────────────────────────────────────────────────
  it("formats autopilot-ended exhausted", () => {
    const e = buildEvent("autopilot-ended", {
      userId: "u5",
      status: "exhausted",
      realizedPnlUsd: -12.5,
    });
    expect(e.kind).toBe("autopilot-ended");
    expect(e.title).toBe("Autopilot ended — budget exhausted");
    expect(e.body).toContain("-$12.5");
  });

  it("formats autopilot-ended target reached", () => {
    const e = buildEvent("autopilot-ended", {
      userId: "u5",
      status: "target",
      realizedPnlUsd: 25,
    });
    expect(e.title).toBe("Autopilot ended — target reached");
    expect(e.body).toContain("+$25");
  });

  it("formats autopilot-ended stopped manually", () => {
    const e = buildEvent("autopilot-ended", {
      userId: "u5",
      status: "stopped",
    });
    expect(e.title).toBe("Autopilot stopped");
    expect(e.body).toContain("stopped");
  });
});
