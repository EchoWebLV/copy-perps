import { describe, expect, it, vi } from "vitest";
import { runSelfV2Open, runSelfV2Deposit } from "./flash-v2-funding";

function resp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** A fetch double that replays scripted responses in call order, recording URLs. */
function makeFetch(scripted: Response[]) {
  let i = 0;
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const r = scripted[i++];
    if (!r) throw new Error(`unexpected fetch #${i}: ${url}`);
    return r;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
}

function makeActions() {
  return {
    signBaseTx: vi.fn(async (_b64: string) => {}),
    enableSession: vi.fn(async () => {}),
    onStatus: vi.fn((_s: string) => {}),
  };
}

const base = (fetchImpl: typeof fetch, actions: ReturnType<typeof makeActions>) => ({
  openBody: { market: "SOL", side: "long", stakeUsdc: 1, leverage: 5, walletAddress: "W" },
  depositUsdc: 1.25,
  walletAddress: "W",
  http: { getAccessToken: async () => "tok", fetchImpl },
  actions,
});

describe("runSelfV2Open", () => {
  it("returns the quote directly when already set up + funded", async () => {
    const { fetchImpl, urls } = makeFetch([resp({ phase: "open", quote: { entryPriceUi: 10 } })]);
    const actions = makeActions();
    const r = await runSelfV2Open(base(fetchImpl, actions));
    expect(r).toEqual({ quote: { entryPriceUi: 10 } });
    expect(actions.enableSession).not.toHaveBeenCalled();
    expect(actions.signBaseTx).not.toHaveBeenCalled();
    expect(urls).toEqual(["/api/trade/perp"]);
  });

  it("drives enable-session → onboard → deposit → open transparently", async () => {
    const { fetchImpl, urls } = makeFetch([
      resp({ phase: "enable-session" }),
      resp({
        phase: "onboard",
        steps: [{ transactionB64: "b1" }, { transactionB64: "b2" }],
      }),
      resp({ phase: "deposit", depositTransaction: "dep" }),
      resp({ phase: "open", quote: { entryPriceUi: 9 } }),
    ]);
    const actions = makeActions();
    const r = await runSelfV2Open(base(fetchImpl, actions));
    expect(r).toEqual({ quote: { entryPriceUi: 9 } });
    expect(actions.enableSession).toHaveBeenCalledTimes(1);
    // 2 onboard steps + 1 deposit tx all signed as base-layer txs.
    expect(actions.signBaseTx.mock.calls.map((c) => c[0])).toEqual(["b1", "b2", "dep"]);
    expect(urls).toEqual([
      "/api/trade/perp",
      "/api/trade/perp",
      "/api/users/me/deposit",
      "/api/trade/perp",
    ]);
  });

  it("deposits once and retries when the open fails on an unfunded basket", async () => {
    const { fetchImpl } = makeFetch([
      resp({ error: "Trade could not open. No funds were spent." }, false, 502),
      resp({ phase: "deposit", depositTransaction: "dep" }),
      resp({ phase: "open", quote: { entryPriceUi: 7 } }),
    ]);
    const actions = makeActions();
    const r = await runSelfV2Open(base(fetchImpl, actions));
    expect(r).toEqual({ quote: { entryPriceUi: 7 } });
    expect(actions.signBaseTx.mock.calls.map((c) => c[0])).toEqual(["dep"]);
  });

  it("throws the real error when the open still fails after funding", async () => {
    const { fetchImpl } = makeFetch([
      resp({ phase: "onboard", steps: [{ transactionB64: "b1" }] }),
      resp({ phase: "deposit", depositTransaction: "dep" }),
      resp({ error: "market closed" }, false, 502),
    ]);
    const actions = makeActions();
    await expect(runSelfV2Open(base(fetchImpl, actions))).rejects.toThrow("market closed");
  });
});

describe("runSelfV2Deposit", () => {
  const depArgs = (fetchImpl: typeof fetch, actions: ReturnType<typeof makeActions>) => ({
    amountUsdc: 1.25,
    walletAddress: "W",
    http: { getAccessToken: async () => "tok", fetchImpl },
    actions,
  });

  it("signs the deposit tx when the basket is already onboarded", async () => {
    const { fetchImpl, urls } = makeFetch([resp({ phase: "deposit", depositTransaction: "dep" })]);
    const actions = makeActions();
    await runSelfV2Deposit(depArgs(fetchImpl, actions));
    expect(actions.signBaseTx.mock.calls.map((c) => c[0])).toEqual(["dep"]);
    expect(urls).toEqual(["/api/users/me/deposit"]);
  });

  it("onboards first, then signs the deposit tx", async () => {
    const { fetchImpl } = makeFetch([
      resp({ phase: "onboard", steps: [{ transactionB64: "s1" }] }),
      resp({ phase: "deposit", depositTransaction: "dep" }),
    ]);
    const actions = makeActions();
    await runSelfV2Deposit(depArgs(fetchImpl, actions));
    expect(actions.signBaseTx.mock.calls.map((c) => c[0])).toEqual(["s1", "dep"]);
  });

  it("throws a clean error when the deposit route rejects", async () => {
    const { fetchImpl } = makeFetch([resp({ error: "Add $0.50 more USDC to trade." }, false, 400)]);
    const actions = makeActions();
    await expect(runSelfV2Deposit(depArgs(fetchImpl, actions))).rejects.toThrow(
      "Add $0.50 more USDC",
    );
  });
});
