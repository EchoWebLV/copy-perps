import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  doublePrecision,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  privyId: text("privy_id").notNull().unique(),
  solanaPubkey: text("solana_pubkey"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    assetId: text("asset_id").notNull(),
    heatScore: integer("heat_score").notNull(),
    payload: jsonb("payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    heatIdx: index("signals_heat_idx").on(t.heatScore),
    typeIdx: index("signals_type_idx").on(t.type),
  }),
);

export const bets = pgTable("bets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  signalId: text("signal_id").references(() => signals.id),
  type: text("type").notNull(),
  amountUsdc: doublePrecision("amount_usdc").notNull(),
  feeUsdc: doublePrecision("fee_usdc"),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"),
  meta: jsonb("meta"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closeTxHash: text("close_tx_hash"),
  proceedsUsdc: doublePrecision("proceeds_usdc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whaleWallets = pgTable("whale_wallets", {
  address: text("address").primaryKey(),
  pnl30d: doublePrecision("pnl_30d"),
  label: text("label"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalId: text("signal_id").notNull(),
    signalType: text("signal_type").notNull(),
    payload: jsonb("payload").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.signalId] }),
    userIdx: index("watchlist_user_idx").on(t.userId, t.addedAt),
  }),
);

export const feedViews = pgTable("feed_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  signalId: text("signal_id").notNull().references(() => signals.id),
  action: text("action").notNull(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
});
