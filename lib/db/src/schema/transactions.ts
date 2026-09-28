import { pgTable, serial, integer, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // fund, withdraw, transfer_in, transfer_out, airtime, data, bill, social, sms
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).default("0"),
  status: text("status").notNull().default("pending"), // pending, success, failed
  reference: text("reference").notNull().unique(),
  description: text("description").notNull(),
  metadata: text("metadata"), // JSON string
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }),
  isFlagged: boolean("is_flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
