import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  doublePrecision,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

export interface FeedPrefs {
  meme: boolean;
  prediction: boolean;
  whale: boolean;
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  privyId: text("privy_id").notNull().unique(),
  solanaPubkey: text("solana_pubkey"),
  // Feed rail toggles. JSONB so adding future rails (e.g. sports)
  // doesn't need a migration. Null = user hasn't completed the
  // onboarding wizard yet → show all rails by default.
  feedPrefs: jsonb("feed_prefs").$type<FeedPrefs>(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bets = pgTable(
  "bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    // No FK — signals are an evictable cache (cron does DELETE+INSERT
    // every 1-2 min), so a hard FK would either block eviction or cascade
    // bet history away. Keep the column as a soft pointer.
    signalId: text("signal_id"),
    type: text("type").notNull(),
    amountUsdc: doublePrecision("amount_usdc").notNull(),
    feeUsdc: doublePrecision("fee_usdc"),
    txHash: text("tx_hash"),
    status: text("status").notNull().default("pending"),
    meta: jsonb("meta"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeTxHash: text("close_tx_hash"),
    proceedsUsdc: doublePrecision("proceeds_usdc"),
    // When set, the bet is published to the public leaderboard. We don't
    // snapshot the card payload — render uses the live `status`, so an
    // open share auto-flips to "final" once closed.
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sharedIdx: index("bets_shared_idx").on(t.sharedAt),
  }),
);

export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentWallets = pgTable("agent_wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Pacifica account = user's main Privy Solana wallet pubkey.
  mainPubkey: text("main_pubkey").notNull(),
  // Agent wallet pubkey we registered to the main account via
  // POST /api/v1/agent/bind.
  agentPubkey: text("agent_pubkey").notNull().unique(),
  // Encrypted Ed25519 seed (32 bytes), AES-256-GCM with the master key
  // in AGENT_WALLET_ENCRYPTION_KEY. Format:
  // base64(iv || ciphertext || authTag).
  agentSecretEnc: text("agent_secret_enc").notNull(),
  // Nullable: bound_at = null marks a generated-but-not-yet-bound agent
  // (onboarding interrupted between keypair generation and the Pacifica
  // bind). getAgentWallet ignores unbound rows; planOnboarding reuses them
  // so a restart mid-onboarding never orphans the bind.
  boundAt: timestamp("bound_at", { withTimezone: true }),
});

export const bots = pgTable("bots", {
  id: text("id").primaryKey(), // e.g. "liquidation-lizard"
  parentId: text("parent_id"), // null for headliners; parent slug for variants
  name: text("name").notNull(),
  avatarEmoji: text("avatar_emoji").notNull(),
  personaVoiceKey: text("persona_voice_key").notNull(),
  strategyKey: text("strategy_key").notNull(),
  config: jsonb("config").notNull(),
  status: text("status").notNull().default("paper"), // 'paper' | 'backtest-fail' | 'live' | 'retired'
  balanceUsd: doublePrecision("balance_usd").notNull().default(1000),
  startingBalanceUsd: doublePrecision("starting_balance_usd").notNull().default(1000),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per message in a per-user, per-bot conversation. The bot's
// auto-narration on opens/closes lives on paper_positions and stays public
// (shown on cards + the Chatter feed). Anything in this table is the
// private back-and-forth between a single user and a single bot.
export const botChats = pgTable(
  "bot_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userBotIdx: index("bot_chats_user_bot_idx").on(
      t.userId,
      t.botId,
      t.createdAt,
    ),
    userTsIdx: index("bot_chats_user_ts_idx").on(t.userId, t.createdAt),
  }),
);

export const paperPositions = pgTable(
  "paper_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    asset: text("asset").notNull(),
    side: text("side").notNull(), // 'long' | 'short'
    leverage: integer("leverage").notNull(),
    stakeUsd: doublePrecision("stake_usd").notNull().default(0),
    entryMark: doublePrecision("entry_mark").notNull(),
    entryTs: timestamp("entry_ts", { withTimezone: true })
      .notNull()
      .defaultNow(),
    exitMark: doublePrecision("exit_mark"),
    exitTs: timestamp("exit_ts", { withTimezone: true }),
    paperPnlUsd: doublePrecision("paper_pnl_usd"),
    triggerMeta: jsonb("trigger_meta"),
    narrationOpen: text("narration_open"),
    narrationClose: text("narration_close"),
    status: text("status").notNull().default("open"), // 'open' | 'closed' | 'expired'
  },
  (t) => ({
    botOpenIdx: index("paper_positions_bot_open_idx").on(t.botId, t.status),
    statusTsIdx: index("paper_positions_status_ts_idx").on(
      t.status,
      t.entryTs,
    ),
  }),
);

// Persistent log of bot-authored in-character thoughts that are NOT tied to
// a trade event. Trade narrations stay on paper_positions.narration_open/close.
// kind: 'near_trade' | 'banter' | 'market_react' | 'position_color' | 'mood_state'
export const botThoughts = pgTable(
  "bot_thoughts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    refMeta: jsonb("ref_meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    botTsIdx: index("bot_thoughts_bot_ts_idx").on(t.botId, t.createdAt),
    tsIdx: index("bot_thoughts_ts_idx").on(t.createdAt),
    botKindTsIdx: index("bot_thoughts_bot_kind_ts_idx").on(
      t.botId,
      t.kind,
      t.createdAt,
    ),
  }),
);

// Singleton settings row controlling thought publication. PK is fixed to
// 'singleton'; we upsert into that one row. Defaults match the design.
export const thoughtSettings = pgTable("thought_settings", {
  id: text("id").primaryKey().default("singleton"),
  enableNearTrade: boolean("enable_near_trade").notNull().default(false),
  enableBanter: boolean("enable_banter").notNull().default(false),
  enableMarketReact: boolean("enable_market_react").notNull().default(false),
  enablePositionColor: boolean("enable_position_color").notNull().default(false),
  enableMoodBadges: boolean("enable_mood_badges").notNull().default(true),
  cooldownNearTradeSec: integer("cooldown_near_trade_sec").notNull().default(300),
  cooldownBanterSec: integer("cooldown_banter_sec").notNull().default(120),
  cooldownMarketReactSec: integer("cooldown_market_react_sec").notNull().default(180),
  cooldownPositionColorSec: integer("cooldown_position_color_sec").notNull().default(900),
  maxThoughtsPerMinute: integer("max_thoughts_per_minute").notNull().default(8),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const whales = pgTable(
  "whales",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceAccountIdx: uniqueIndex("whales_source_account_idx").on(
      t.source,
      t.sourceAccount,
    ),
    statusIdx: index("whales_status_idx").on(t.status),
  }),
);

export const whalePositions = pgTable(
  "whale_positions",
  {
    id: text("id").primaryKey(),
    whaleId: text("whale_id")
      .notNull()
      .references(() => whales.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceAccount: text("source_account").notNull(),
    market: text("market").notNull(),
    side: text("side").notNull(),
    leverage: integer("leverage").notNull(),
    amountBase: doublePrecision("amount_base").notNull(),
    notionalUsd: doublePrecision("notional_usd").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    currentMark: doublePrecision("current_mark"),
    unrealizedPnlPct: doublePrecision("unrealized_pnl_pct"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    whaleOpenIdx: index("whale_positions_whale_open_idx").on(t.whaleId, t.status),
    sourceOpenIdx: index("whale_positions_source_open_idx").on(
      t.source,
      t.sourceAccount,
      t.status,
    ),
    openFreshIdx: index("whale_positions_open_fresh_idx").on(t.status, t.lastSeenAt),
  }),
);

export const whalePositionAnalysis = pgTable(
  "whale_position_analysis",
  {
    positionId: text("position_id")
      .primaryKey()
      .references(() => whalePositions.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    thesis: text("thesis").notNull(),
    risk: text("risk").notNull(),
    entryGapWarning: text("entry_gap_warning"),
    confidence: doublePrecision("confidence").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const pulseReactions = pgTable(
  "pulse_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: text("position_id")
      .notNull()
      .references(() => whalePositions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    positionUserIdx: uniqueIndex("pulse_reactions_position_user_idx").on(
      t.positionId,
      t.userId,
    ),
    positionReactionIdx: index("pulse_reactions_position_reaction_idx").on(
      t.positionId,
      t.reaction,
    ),
  }),
);

export const pulseComments = pgTable(
  "pulse_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: text("position_id")
      .notNull()
      .references(() => whalePositions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    positionCreatedIdx: index("pulse_comments_position_created_idx").on(
      t.positionId,
      t.createdAt,
    ),
    userCreatedIdx: index("pulse_comments_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);
