// lib/sources/hl-wallet.ts
//
// Hyperliquid wallet source adapter. Polls clearinghouseState for one
// specific user address and reports back the wallet's current open
// positions in the SourcePosition shape. The source-mirror strategy
// diffs this against the bot's own positions every tick.

import { getClearinghouseState } from "@/lib/hyperliquid/client";
import type { Source, SourcePosition } from "./types";

// Restrict mirrored assets to the trio we trade on Pacifica/Flash —
// the source may hold positions in HL-only markets (e.g. XMR, STBL,
// HYPE on some periods) that we can't replicate.
const ALLOWED_ASSETS = new Set(["BTC", "ETH", "SOL"]);

interface HlWalletSourceParams {
  /** EVM address of the HL account to mirror. */
  address: string;
  /** Display name for narration (e.g. "Whale 0xb83de0…6e36"). */
  displayName?: string;
}

export function createHlWalletSource(p: HlWalletSourceParams): Source {
  const id = `hl-wallet-${p.address.toLowerCase()}`;
  const displayName =
    p.displayName ??
    `HL ${p.address.slice(0, 6)}…${p.address.slice(-4)}`;
  const externalUrl = `https://app.hyperliquid.xyz/explorer/address/${p.address}`;

  return {
    id,
    displayName,
    externalUrl,
    async getCurrentPositions(): Promise<SourcePosition[]> {
      let state;
      try {
        state = await getClearinghouseState(p.address);
      } catch (err) {
        console.warn(`[${id}] HL clearinghouseState failed:`, err);
        return [];
      }
      const out: SourcePosition[] = [];
      for (const ap of state.assetPositions ?? []) {
        const pos = ap.position;
        if (!pos) continue;
        if (!ALLOWED_ASSETS.has(pos.coin)) continue;
        const szi = Number(pos.szi);
        if (!Number.isFinite(szi) || szi === 0) continue;
        const entry = Number(pos.entryPx);
        if (!Number.isFinite(entry) || entry <= 0) continue;
        const lev = pos.leverage?.value ?? 1;
        const notional = Math.abs(Number(pos.positionValue));
        out.push({
          externalId: `${id}-${pos.coin}-${szi > 0 ? "L" : "S"}`,
          asset: pos.coin,
          side: szi > 0 ? "long" : "short",
          entryPx: entry,
          leverage: Number(lev) || 1,
          notionalUsd: Number.isFinite(notional) ? notional : 0,
          openedAtMs: null,
          meta: {
            sourceKind: "hl-wallet",
            address: p.address,
            unrealizedPnl: Number(pos.unrealizedPnl) || 0,
            roe: Number(pos.returnOnEquity) || 0,
          },
        });
      }
      return out;
    },
  };
}
