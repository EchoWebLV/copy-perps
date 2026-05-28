import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("App route title chrome", () => {
  it("does not render desktop rail title labels", () => {
    const source = readFileSync(
      join(process.cwd(), "components/shell/DesktopContextRail.tsx"),
      "utf8",
    );

    expect(source).not.toContain("mb-3");
    expect(source).not.toContain(">{title}</div>");
  });

  it("removes legacy route title bands from wins and chatter fallbacks", () => {
    const leaderboard = readFileSync(
      join(process.cwd(), "app/(app)/leaderboard/page.tsx"),
      "utf8",
    );
    const chatter = readFileSync(
      join(process.cwd(), "app/(app)/chatter/page.tsx"),
      "utf8",
    );

    expect(leaderboard).not.toContain("<h1");
    expect(leaderboard).not.toContain("Live and final cards from the feed");
    expect(chatter).not.toContain('{`"CHATTER"`}');
    expect(chatter).not.toContain("Every bot, every trade, in their voice.");
  });
});
