// lib/sources/pacifica-wallet.ts
//
// Pacifica wallet source adapter. Polls /positions for one specific
// account address and reports its current open positions in the
// SourcePosition shape.
//
// Leverage handling: Pacifica's /positions endpoint doesn't surface a
// per-position leverage value (cross-margin accounts share an
// account-level lev). We infer leverage from notional/margin when the
// position is isolated; for cross we default to a configurable
// fallback (typically 5-10x). The mirror strategy applies its own
// cap, so even if we read it wrong we won't over-leverage.

import { getPositions } from "@/lib/pacifica/client";
import type { Source, SourcePosition } from "./types";

const ALLOWED_ASSETS = new Set(["BTC", "ETH", "SOL"]);

interface PacificaWalletSourceParams {
  address: string;
  displayName?: string;
  /** Leverage to assume when Pacifica reports margin=0 (cross account). */
  defaultLeverage?: number;
}

export function createPacificaWalletSource(
  p: PacificaWalletSourceParams,
): Source {
  const id = `pacifica-wallet-${p.address.toLowerCase()}`;
  const displayName =
    p.displayName ??
    `Pacifica ${p.address.slice(0, 4)}…${p.address.slice(-4)}`;
  const externalUrl = `https://pacifica.fi/leaderboard/${p.address}`;
  const defaultLev = p.defaultLeverage ?? 5;

  return {
    id,
    displayName,
    externalUrl,
    async getCurrentPositions(): Promise<SourcePosition[]> {
      let positions;
      try {
        positions = await getPositions(p.address);
      } catch (err) {
        console.warn(`[${id}] Pacifica getPositions failed:`, err);
        return [];
      }
      const out: SourcePosition[] = [];
      for (const pos of positions) {
        if (!ALLOWED_ASSETS.has(pos.symbol)) continue;
        const amount = Number(pos.amount);
        const entry = Number(pos.entry_price);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        if (!Number.isFinite(entry) || entry <= 0) continue;
        const side: "long" | "short" =
          pos.side === "bid" ? "long" : "short";
        const margin = Number(pos.margin);
        const notional = amount * entry;
        // Isolated: leverage = notional / margin. Cross (margin=0):
        // fall back to defaultLeverage.
        const leverage =
          pos.isolated && margin > 0
            ? Math.max(1, Math.round(notional / margin))
            : defaultLev;
        out.push({
          externalId: `${id}-${pos.symbol}-${side === "long" ? "L" : "S"}`,
          asset: pos.symbol,
          side,
          entryPx: entry,
          leverage,
          notionalUsd: notional,
          openedAtMs: pos.created_at ? pos.created_at * 1000 : null,
          meta: {
            sourceKind: "pacifica-wallet",
            address: p.address,
            isolated: pos.isolated,
            funding: Number(pos.funding) || 0,
          },
        });
      }
      return out;
    },
  };
}
