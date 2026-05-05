import { CURATED_WHALES } from "@/lib/hyperliquid/whales";

const ASSETS = new Set(["SOL", "BTC", "ETH"]);
const MIN_POSITION_USD = 25_000;
const MIN_LEVERAGE = 1.5;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_PER_WHALE = 5;

interface RawPos {
  coin: string;
  szi: string;
  positionValue: string;
  leverage?: { value?: number };
}
interface RawState {
  marginSummary: { accountValue: string };
  assetPositions: { position: RawPos }[];
}
interface RawFill {
  coin: string;
  dir: string;
  time: number;
}

async function call<T>(type: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...body }),
  });
  if (!r.ok) throw new Error(`${type} ${r.status}`);
  return (await r.json()) as T;
}

function fillOpensSide(dir: string, side: "long" | "short"): boolean {
  if (side === "long") return dir === "Open Long" || dir === "Short > Long";
  return dir === "Open Short" || dir === "Long > Short";
}

async function main() {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  console.log(`Pass 1: fetching fills for ${CURATED_WHALES.length} wallets (serial)...`);
  const pass1: { address: string; opens: RawFill[]; err: string | null }[] = [];
  for (const { address } of CURATED_WHALES) {
    try {
      const fills = await call<RawFill[]>("userFillsByTime", {
        user: address,
        startTime: windowStart,
      });
      const opens = fills.filter((f) =>
        /^(Open |Long > Short|Short > Long)/.test(String(f.dir)),
      );
      pass1.push({ address, opens, err: null });
    } catch (e) {
      pass1.push({ address, opens: [], err: String(e) });
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const errors = pass1.filter((p) => p.err);
  const active = pass1.filter((p) => p.opens.length > 0);
  console.log(`  errors: ${errors.length}, wallets-with-opens: ${active.length}`);

  console.log(`Pass 2: fetching state for ${active.length} active wallets...`);
  const signals: {
    coin: string;
    side: string;
    lev: number;
    sz: number;
    openedAt: number;
    addr: string;
  }[] = [];
  const skip = { noQualifyingPos: 0, noMatchingFill: 0, wrongAsset: 0, stateErr: 0 };

  for (const { address, opens } of active) {
    try {
      const state = await call<RawState>("clearinghouseState", { user: address });
      const accVal = parseFloat(state.marginSummary.accountValue);
      if (accVal <= 0) continue;
      const positions = state.assetPositions
        .map((ap) => ap.position)
        .filter((p) => {
          if (!ASSETS.has(p.coin.toUpperCase())) {
            skip.wrongAsset++;
            return false;
          }
          if (parseFloat(p.positionValue) < MIN_POSITION_USD) return false;
          if ((p.leverage?.value ?? 0) < MIN_LEVERAGE) return false;
          return true;
        });
      if (positions.length === 0) skip.noQualifyingPos++;

      for (const pos of positions) {
        const sz = parseFloat(pos.szi);
        const side: "long" | "short" = sz >= 0 ? "long" : "short";
        const candidates = opens
          .filter(
            (f) =>
              f.coin === pos.coin && fillOpensSide(String(f.dir), side),
          )
          .sort((a, b) => b.time - a.time);
        if (candidates.length === 0) {
          skip.noMatchingFill++;
          continue;
        }
        signals.push({
          coin: pos.coin,
          side,
          lev: pos.leverage?.value ?? 0,
          sz: parseFloat(pos.positionValue),
          openedAt: candidates[0].time,
          addr: address,
        });
      }
    } catch {
      skip.stateErr++;
    }
  }

  console.log(`\n→ Final signals (after TOP_PER_WHALE=${TOP_PER_WHALE} cap): ${signals.length}`);
  console.log(`  skip reasons:`, skip);
  signals.sort((a, b) => b.openedAt - a.openedAt);
  console.log(`\nSignal sample (newest first):`);
  for (const s of signals.slice(0, 25)) {
    const ageMin = (now - s.openedAt) / 60_000;
    const ageStr = ageMin < 60 ? `${Math.round(ageMin)}m` : `${(ageMin / 60).toFixed(1)}h`;
    console.log(
      `  ${s.coin.padEnd(4)} ${s.side.padEnd(5)} ${String(s.lev).padStart(2)}x  $${(s.sz / 1000).toFixed(0).padStart(5)}k  ${ageStr.padStart(5)} ago  ${s.addr.slice(0, 10)}`,
    );
  }
}

main().catch(console.error);
