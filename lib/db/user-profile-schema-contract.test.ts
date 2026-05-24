import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("user profile database schema", () => {
  it("defines persisted display metadata for social surfaces", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/db/schema.ts"),
      "utf8",
    );

    expect(source).toContain('displayName: text("display_name")');
    expect(source).toContain('handle: text("handle")');
    expect(source).toContain('avatarSeed: text("avatar_seed")');
    expect(source).toContain('updatedAt: timestamp("updated_at"');
  });
});
