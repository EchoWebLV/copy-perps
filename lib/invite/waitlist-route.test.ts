import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert } }));
vi.mock("@/lib/db/schema", () => ({ waitlist: { __table: "waitlist" } }));

import { POST } from "@/app/api/waitlist/route";

function req(body: unknown) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onConflictDoNothing.mockResolvedValue(undefined);
  mocks.values.mockReturnValue({
    onConflictDoNothing: mocks.onConflictDoNothing,
  });
  mocks.insert.mockReturnValue({ values: mocks.values });
});

describe("POST /api/waitlist", () => {
  it("accepts a valid email, normalizes it, and inserts deduped", async () => {
    const res = await POST(req({ email: "  Degen@Example.com " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.values).toHaveBeenCalledWith({ email: "degen@example.com" });
    expect(mocks.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("treats a duplicate email as success (onConflictDoNothing, no error)", async () => {
    const res = await POST(req({ email: "dupe@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an invalid email with 400 and never inserts", async () => {
    const res = await POST(req({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank email with 400", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ email: "   " }))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
