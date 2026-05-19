import { beforeEach, describe, expect, it, vi } from "vitest";

import { bindAgentWallet } from "./client";

describe("Pacifica signed POST errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("includes plain-text Pacifica error bodies", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Verification failed", { status: 400 }),
    );

    await expect(
      bindAgentWallet({
        account: "account",
        signatureB58: "signature",
        header: {
          type: "bind_agent_wallet",
          timestamp: 1,
          expiry_window: 5000,
        },
        payload: { agent_wallet: "agent" },
      }),
    ).rejects.toThrow(
      "Pacifica POST /agent/bind failed: Verification failed",
    );
  });

  it("sends hardware signature objects unchanged", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { ok: true },
          error: null,
          code: null,
        }),
        { status: 200 },
      ),
    );

    await bindAgentWallet({
      account: "account",
      signatureB58: { type: "hardware", value: "signature" },
      header: {
        type: "bind_agent_wallet",
        timestamp: 1,
        expiry_window: 5000,
      },
      payload: { agent_wallet: "agent" },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.signature).toEqual({ type: "hardware", value: "signature" });
  });
});
