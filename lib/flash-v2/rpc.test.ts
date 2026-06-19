// lib/flash-v2/rpc.test.ts
import { describe, expect, it } from "vitest";
import { endpointForLayer } from "./rpc";

describe("endpointForLayer", () => {
  const opts = { baseRpc: "https://base.example", erRpc: "https://er.example" };
  it("routes trade ops to the ER endpoint", () => {
    expect(endpointForLayer("er", opts)).toBe("https://er.example");
  });
  it("routes setup/withdraw ops to the base endpoint", () => {
    expect(endpointForLayer("base", opts)).toBe("https://base.example");
  });
});
