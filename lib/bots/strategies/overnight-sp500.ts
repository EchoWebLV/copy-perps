// lib/bots/strategies/overnight-sp500.ts
//
// Atlas's new brain: the Bessembinder overnight-drift trade. Long
// SPX from 4pm ET close to 9:30am ET next open. Documented persistent
// edge — ~95% of SP500's long-term return historically comes from
// these overnight windows; intraday returns net to near zero.
//
// One trade per US weekday. Hold ~17.5 hours. Lev 4-6x. Closed when
// the 09:30 ET cash open hits OR a hard stop fires.
//
// We use Intl.DateTimeFormat with America/New_York to compute ET time
// rather than a hardcoded UTC offset — that way the bot stays correct
// across DST flips without code edits.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";

const ASSET = "SP500";
const ENTRY_HOUR_ET = 16.0; // 16:00 ET = NYSE cash close
const EXIT_HOUR_ET = 9.5; // 09:30 ET = NYSE cash open
const HARD_STOP_PCT = 0.015; // 1.5% adverse on PRICE — kills bad nights early
const MAX_HOLD_MS = 18 * 60 * 60 * 1000;
const FIXED_LEVERAGE = 10;
const COOLDOWN_AFTER_CLOSE_MS = 4 * 60 * 60 * 1000; // 4h cooldown — avoids
                                                    // immediate re-entry if
                                                    // we stop out, and only
                                                    // lets one overnight
                                                    // trade per session.

const _lastCloseAt = { ts: 0 };

function getEtTime(): { hourFloat: number; isWeekend: boolean } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return {
    hourFloat: h + m / 60,
    isWeekend: day === "Sat" || day === "Sun",
  };
}

/** Is "now" inside the overnight window? Window is 16:00 ET (close)
 *  through 09:30 ET next morning (cash open). Skipped on weekends. */
function isOvernightWindow(): boolean {
  const { hourFloat, isWeekend } = getEtTime();
  if (isWeekend) {
    // Sunday eve (after 17:00 ET futures re-open) is a special case
    // we don't worry about — keep it simple, no weekend trades.
    return false;
  }
  return hourFloat >= ENTRY_HOUR_ET || hourFloat < EXIT_HOUR_ET;
}

export const OvernightSP500Strategy: Strategy = {
  id: "overnight-sp500",
  markets: [ASSET] as readonly string[],

  evaluateEntry(
    ctx: MarketContext,
    _signals: ExternalSignals,
  ): EntryDecision | null {
    if (ctx.asset !== ASSET) return null;
    if (Date.now() - _lastCloseAt.ts < COOLDOWN_AFTER_CLOSE_MS) return null;
    if (!isOvernightWindow()) return null;
    return {
      asset: ASSET,
      side: "long",
      leverage: FIXED_LEVERAGE,
      conviction: clampConviction(0.7),
      triggerMeta: {
        strategy: "overnight-sp500",
        entryHourEt: ENTRY_HOUR_ET,
        exitHourEt: EXIT_HOUR_ET,
        dynamicLeverage: FIXED_LEVERAGE,
        conviction: 0.7,
      },
    };
  },

  evaluateExit(
    ctx: MarketContext,
    position: PaperPosition,
  ): boolean {
    const heldMs = Date.now() - position.entryTs.getTime();
    if (heldMs >= MAX_HOLD_MS) {
      _lastCloseAt.ts = Date.now();
      return true;
    }
    // Hard stop: if SPX drops 1.5%+ from entry on a long, bail. Stops
    // out the gnarly overnight drawdowns (Aug 2024 carry unwind, etc.)
    // without surrendering the overnight edge entirely.
    const moveFrac = (ctx.mark - position.entryMark) / position.entryMark;
    const favorable = position.side === "long" ? moveFrac : -moveFrac;
    if (favorable <= -HARD_STOP_PCT) {
      _lastCloseAt.ts = Date.now();
      return true;
    }
    // Time exit: out of the overnight window means morning is here.
    if (!isOvernightWindow()) {
      _lastCloseAt.ts = Date.now();
      return true;
    }
    return false;
  },
};
