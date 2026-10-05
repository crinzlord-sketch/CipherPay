import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const giftCardOrdersTable = pgTable("gift_card_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  countryCode: text("country_code").notNull(),
  currencyCode: text("currency_code").notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  amountPaidNgn: numeric("amount_paid_ngn", { precision: 18, scale: 2 }).notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").notNull().default("pending"),
  redemptionCode: text("redemption_code"),
  pin: text("pin"),
  externalTransactionId: text("external_transaction_id"),
  transactionId: integer("transaction_id"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GiftCardOrder = typeof giftCardOrdersTable.$inferSelect;
