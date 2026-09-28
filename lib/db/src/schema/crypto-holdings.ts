import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const cryptoHoldingsTable = pgTable("crypto_holdings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  coinId: text("coin_id").notNull(),
  coinSymbol: text("coin_symbol").notNull(),
  coinName: text("coin_name").notNull(),
  amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
  totalCostNgn: numeric("total_cost_ngn", { precision: 20, scale: 2 }).notNull(),
  avgBuyPriceNgn: numeric("avg_buy_price_ngn", { precision: 20, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CryptoHolding = typeof cryptoHoldingsTable.$inferSelect;
