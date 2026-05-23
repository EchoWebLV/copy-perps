import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("whale refresh cron route", () => {
  it("uses the merged whale refresh coordinator", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/cron/refresh-whales/route.ts"),
      "utf8",
    );

    expect(source).toContain("refreshWhales");
    expect(source).not.toContain("refreshPacificaWhales");
  });
});
