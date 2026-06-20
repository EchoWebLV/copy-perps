import { describe, expect, it } from "vitest";
import { indexThoughtsByTape, type ArenaThought } from "./thoughts";

function thought(over: Partial<ArenaThought>): ArenaThought {
  return {
    persona: "claude-v1",
    action: "open",
    side: "long",
    asset: "SOL",
    leverage: 10,
    confidence: 0.7,
    reasoning: "momentum breakout",
    sent: true,
    rejectReason: null,
    signature: "sig",
    tapeTsMs: 1000,
    createdAtMs: 1000,
    ...over,
  };
}

describe("indexThoughtsByTape", () => {
  it("keys sent decisions by the tape entry they wrote", () => {
    const map = indexThoughtsByTape([
      thought({ tapeTsMs: 1000, reasoning: "A" }),
      thought({ tapeTsMs: 2000, reasoning: "B" }),
    ]);
    expect(map.get(1000)?.reasoning).toBe("A");
    expect(map.get(2000)?.reasoning).toBe("B");
    expect(map.size).toBe(2);
  });

  it("drops thoughts with no tapeTsMs (HOLD / skip / missed read-back)", () => {
    const map = indexThoughtsByTape([
      thought({ tapeTsMs: null, action: "hold", reasoning: "waiting" }),
      thought({ tapeTsMs: 3000, reasoning: "traded" }),
    ]);
    expect(map.has(3000)).toBe(true);
    expect(map.size).toBe(1);
  });

  it("keeps the newest when two rows collide on tapeTsMs", () => {
    const map = indexThoughtsByTape([
      thought({ tapeTsMs: 5000, reasoning: "old", createdAtMs: 100 }),
      thought({ tapeTsMs: 5000, reasoning: "new", createdAtMs: 200 }),
    ]);
    expect(map.get(5000)?.reasoning).toBe("new");
    expect(map.size).toBe(1);
  });
});
