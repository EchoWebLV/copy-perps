import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TailModal Privy sponsored deposit send", () => {
  it("sends deposit transactions through Privy sponsorship instead of raw RPC broadcast", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );
    const depositFlow = source.slice(
      source.indexOf("const signAndSendDeposit"),
      source.indexOf("const openOne"),
    );

    expect(source).toContain("useSignAndSendTransaction");
    expect(depositFlow).toContain("signAndSendTransaction({");
    expect(depositFlow).toContain("sponsor: true");
    expect(depositFlow).not.toContain("signTransaction({");
    expect(depositFlow).not.toContain("sendRawTransaction");
  });
});
