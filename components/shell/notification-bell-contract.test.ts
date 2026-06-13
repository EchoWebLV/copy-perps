import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("NotificationBell component contract", () => {
  const source = readFileSync(
    join(process.cwd(), "components/shell/NotificationBell.tsx"),
    "utf8",
  );

  it("is a client component", () => {
    expect(source).toMatch(/^"use client"/);
  });

  it("polls /api/notifications with a Privy Bearer token", () => {
    expect(source).toContain("/api/notifications");
    expect(source).toContain("getAccessToken");
    expect(source).toContain("Authorization: `Bearer ${token}`");
  });

  it("only polls when the user is authenticated", () => {
    expect(source).toContain("authenticated");
    // Guard: returns null or early-returns when not authenticated
    expect(source).toMatch(/if\s*\(!authenticated\)/);
  });

  it("uses a visibility-aware poll pattern (document.hidden)", () => {
    expect(source).toContain("document.hidden");
    expect(source).toContain("visibilitychange");
    expect(source).toContain("POLL_MS");
  });

  it("shows an unread badge when unread > 0", () => {
    // The badge is conditionally rendered
    expect(source).toContain("unread > 0");
  });

  it("renders the unread count in the badge", () => {
    expect(source).toContain("{unread}");
  });

  it("marks all read on open via POST /api/notifications", () => {
    expect(source).toContain('method: "POST"');
  });

  it("optimistically zeros the badge before the server responds", () => {
    expect(source).toContain("setUnread(0)");
  });

  it("shows the Activity sheet title and subtitle from the mock", () => {
    expect(source).toContain("Activity");
    expect(source).toContain("Every copy event, the moment it happens.");
  });

  it("shows the empty-state message from the mock spec", () => {
    expect(source).toContain("No alerts yet.");
    expect(source).toContain("Copy a trader and we");
    expect(source).toContain("opens, closes, and auto-closes");
  });

  it("renders a relative time for each event", () => {
    expect(source).toContain("timeAgo");
  });

  it("uses the ACCENT color for the badge (per design tokens)", () => {
    expect(source).toContain("ACCENT");
  });
});

describe("NotificationBell mount in BottomNav (global mobile)", () => {
  const source = readFileSync(
    join(process.cwd(), "components/shell/BottomNav.tsx"),
    "utf8",
  );

  it("imports NotificationBell from the shell directory", () => {
    expect(source).toContain('from "@/components/shell/NotificationBell"');
  });

  it("renders NotificationBell in a fixed top-right overlay for mobile", () => {
    expect(source).toContain("<NotificationBell");
    expect(source).toContain("fixed top-3 right-3");
    expect(source).toContain("lg:hidden");
  });
});

describe("NotificationBell mount in DesktopNav", () => {
  const source = readFileSync(
    join(process.cwd(), "components/shell/DesktopNav.tsx"),
    "utf8",
  );

  it("imports NotificationBell", () => {
    expect(source).toContain('from "./NotificationBell"');
  });

  it("renders NotificationBell in the sidebar", () => {
    expect(source).toContain("<NotificationBell");
  });
});
