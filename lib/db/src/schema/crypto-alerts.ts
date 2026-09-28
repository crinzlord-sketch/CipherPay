import { pgTable, serial, integer, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";

export const cryptoPriceAlertsTable = pgTable("crypto_price_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  coinId: text("coin_id").notNull(),
  coinSymbol: text("coin_symbol").notNull(),
  coinName: text("coin_name").notNull(),
  targetPrice: numeric("target_price", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("ngn"),
  direction: text("direction").notNull(),
  active: boolean("active").notNull().default(true),
  triggered: boolean("triggered").notNull().default(false),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CryptoPriceAlert = typeof cryptoPriceAlertsTable.$inferSelect;
