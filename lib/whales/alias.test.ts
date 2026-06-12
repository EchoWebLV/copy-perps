import { describe, expect, it } from "vitest";
import {
  isAutoWhaleName,
  shortWhaleAccount,
  whaleAlias,
  whaleDisplayName,
} from "./alias";

describe("whaleAlias", () => {
  it("is deterministic and two-word", () => {
    const a = whaleAlias("0x8def000000000000000000000000000000002dae");
    expect(whaleAlias("0x8def000000000000000000000000000000002dae")).toBe(a);
    expect(a.split(" ")).toHaveLength(2);
  });

  it("differs across nearby accounts", () => {
    const seen = new Set(
      Array.from({ length: 12 }, (_, i) => whaleAlias(`0xacct${i}`)),
    );
    expect(seen.size).toBeGreaterThan(8); // collisions allowed, sameness not
  });
});

describe("isAutoWhaleName", () => {
  it("flags address-ish placeholders", () => {
    expect(isAutoWhaleName("HL 0X8DEF...2DAE")).toBe(true);
    expect(isAutoWhaleName("whale_HDw3")).toBe(true);
    expect(isAutoWhaleName("0x17c3a868")).toBe(true);
    expect(isAutoWhaleName("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(
      true,
    );
    expect(isAutoWhaleName("ABC…DEF")).toBe(true);
  });

  it("keeps curated names", () => {
    expect(isAutoWhaleName("JohnLockePAC")).toBe(false);
    expect(isAutoWhaleName("lateBdoerPAC")).toBe(false);
  });
});

describe("whaleDisplayName", () => {
  it("aliases placeholders, passes curated through", () => {
    expect(whaleDisplayName("JohnLockePAC", "AcctA")).toBe("JohnLockePAC");
    const aliased = whaleDisplayName("HL 0X8DEF...2DAE", "0x8def2dae");
    expect(aliased).toBe(whaleAlias("0x8def2dae"));
    expect(aliased).not.toMatch(/0x/i);
  });
});

describe("shortWhaleAccount", () => {
  it("middle-truncates long accounts only", () => {
    expect(shortWhaleAccount("0x8def00112233445566772dae")).toBe("0x8def…2dae");
    expect(shortWhaleAccount("short")).toBe("short");
  });
});
