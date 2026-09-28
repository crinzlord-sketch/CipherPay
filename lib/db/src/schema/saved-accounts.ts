import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const savedAccountsTable = pgTable("saved_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSavedAccountSchema = createInsertSchema(savedAccountsTable).omit({ id: true, createdAt: true });
export type InsertSavedAccount = z.infer<typeof insertSavedAccountSchema>;
export type SavedAccount = typeof savedAccountsTable.$inferSelect;
