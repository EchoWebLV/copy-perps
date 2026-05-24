import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pulse social database schema", () => {
  it("defines persisted reactions and comments keyed by whale position", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/db/schema.ts"),
      "utf8",
    );

    expect(source).toContain("export const pulseReactions");
    expect(source).toContain("export const pulseComments");
    expect(source).toContain('"pulse_reactions"');
    expect(source).toContain('"pulse_comments"');
    expect(source).toContain("pulse_reactions_position_user_idx");
    expect(source).toContain("pulse_comments_position_created_idx");
    expect(source).toContain("references(() => whalePositions.id");
    expect(source).toContain("references(() => users.id");
  });
});
