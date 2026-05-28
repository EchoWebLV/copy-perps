import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Profile share card", () => {
  it("lets users set an @ handle and share their generated code", () => {
    const source = readFileSync(
      join(process.cwd(), "components/settings/ProfileShareCard.tsx"),
      "utf8",
    );

    expect(source).toContain("/api/users/me");
    expect(source).toContain("makeProfileCodeColorPattern");
    expect(source).toContain("buildProfileShareUrl");
    expect(source).toContain("navigator.share");
    expect(source).toContain("CUSTOM CODE");
    expect(source).toContain("SAVE @");
  });
});
