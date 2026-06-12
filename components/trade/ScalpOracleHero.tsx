"use client";

// Template-style oracle hero for the Scalp screen, modeled on MagicBlock's
// pyth-template (pyth-template.magicblock.app): market pill + Connected
// badge, a big glowing live price, and below the chart the on-chain account
// caption with PRICE UPDATES / LIVE PRICE STREAM cards. All numbers come from
// the ER Lazer feed subscription in FlashLivePriceProvider (same oracle tier
// Flash executes against); the Connected badge is honest — it drops when ER
// deliveries stop, even though the SSE fallback keeps prices flowing.

import { useEffect, useRef, useState } from "react";
import {
  useFlashLiveMarks,
  useFlashOracleStats,
} from "@/lib/flash/live-prices-context";
import type { FlashLivePriceSymbol } from "@/lib/flash/live-prices";
import { FLASH_ORACLE_FEED_PDAS } from "@/lib/flash/oracle-marks";
import { isOracleFresh } from "./OracleLiveBadge";
import { DIM, FAINT, FG, PANEL } from "@/components/v2/ui";

// The template's lavender-on-black accent, used only on this surface.
const LAVENDER = "#c4b5fd";
const LAVENDER_GLOW = "0 0 28px rgba(167,139,250,0.35)";

const MARKET_LONG_NAMES: Record<FlashLivePriceSymbol, string> = {
  SOL: "SOLANA / US DOLLAR",
  BTC: "BITCOIN / US DOLLAR",
  ETH: "ETHEREUM / US DOLLAR",
};

export function isOracleSymbol(
  market: string,
): market is FlashLivePriceSymbol {
  return market === "SOL" || market === "BTC" || market === "ETH";
}

/** Template-style price text: 4 decimals under $1k (66.7863), 2 above. */
export function fmtOraclePrice(priceUsd: number): string {
  const dp = priceUsd >= 1000 ? 2 : 4;
  return priceUsd.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function shortAddress(address: string): string {
  return address.length <= 11
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function useNowTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Header + giant price. Renders nothing for non-oracle markets. */
export function ScalpOracleHero({ market }: { market: string }) {
  const marks = useFlashLiveMarks();
  const { lastDeliveryMs } = useFlashOracleStats();
  const now = useNowTick(5_000);
  if (!isOracleSymbol(market)) return null;
  const mark = marks[market];
  const connected = isOracleFresh(lastDeliveryMs, now);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex min-w-0 items-baseline gap-2 rounded-2xl px-4 py-2.5"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          <span
            className="text-[14px] font-black tracking-wide"
            style={{ color: FG }}
          >
            {market}USD
          </span>
          <span
            className="truncate text-[10px] uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {MARKET_LONG_NAMES[market]}
          </span>
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2.5 text-[11px] font-semibold"
          style={{
            background: PANEL,
            border: `1px solid ${FAINT}`,
            color: connected ? FG : DIM,
          }}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "animate-pulse" : ""}`}
            style={{ background: connected ? "#1de78b" : "rgba(250,250,242,0.25)" }}
          />
          {connected ? "Connected" : "Stream"}
        </span>
      </div>

      <div
        className="mt-3 flex items-center justify-center gap-3 rounded-3xl px-4 py-6"
        style={{ background: PANEL, border: `1px solid ${FAINT}` }}
      >
        <span
          className="text-3xl font-black"
          style={{ color: DIM }}
          aria-hidden
        >
          $
        </span>
        <span
          className="text-5xl font-black tabular-nums tracking-tight sm:text-6xl"
          style={{ color: LAVENDER, textShadow: LAVENDER_GLOW }}
          data-testid="oracle-hero-price"
        >
          {mark ? fmtOraclePrice(mark.priceUsd) : "—"}
        </span>
      </div>
    </div>
  );
}

/** Caption + stats cards under the chart. Renders nothing for non-oracle
 *  markets. */
export function ScalpOracleFooter({ market }: { market: string }) {
  const marks = useFlashLiveMarks();
  const { updateCount } = useFlashOracleStats();
  // Rolling stream of the last few rendered prices (per market).
  const streamRef = useRef<{ key: number; line: string }[]>([]);
  const lastTsRef = useRef(0);
  const mark = isOracleSymbol(market) ? marks[market] : undefined;
  if (mark && mark.publishTimeMs !== lastTsRef.current) {
    lastTsRef.current = mark.publishTimeMs;
    const time = new Date(mark.publishTimeMs).toLocaleTimeString("en-US", {
      hour12: false,
    });
    streamRef.current = [
      { key: mark.publishTimeMs, line: `${time}  $${fmtOraclePrice(mark.priceUsd)}` },
      ...streamRef.current,
    ].slice(0, 5);
  }
  if (!isOracleSymbol(market)) return null;
  const feed = FLASH_ORACLE_FEED_PDAS[market];

  return (
    <div className="mt-3">
      <p
        className="text-center text-[10px] leading-relaxed"
        style={{ color: DIM }}
      >
        processing directly from the associated onchain account:{" "}
        <span style={{ color: FG }}>{shortAddress(feed)}</span>
      </p>
      <div className="mt-2 grid grid-cols-[1fr_1.6fr] gap-2">
        <div
          className="flex flex-col items-center justify-center rounded-2xl px-3 py-4"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          <span
            className="text-[9px] uppercase tracking-widest"
            style={{ color: DIM }}
          >
            price updates
          </span>
          <span
            className="mt-1 text-2xl font-black tabular-nums"
            style={{ color: LAVENDER }}
            data-testid="oracle-update-count"
          >
            {updateCount.toLocaleString("en-US")}
          </span>
        </div>
        <div
          className="rounded-2xl px-3 py-2.5"
          style={{ background: PANEL, border: `1px solid ${FAINT}` }}
        >
          <span
            className="text-[9px] uppercase tracking-widest"
            style={{ color: DIM }}
          >
            live price stream
          </span>
          <div className="mt-1 space-y-0.5">
            {streamRef.current.length === 0 ? (
              <p className="text-[10px]" style={{ color: DIM }}>
                waiting for updates…
              </p>
            ) : (
              streamRef.current.map((e) => (
                <p
                  key={e.key}
                  className="font-mono text-[10px] tabular-nums"
                  style={{ color: FG }}
                >
                  {e.line}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
