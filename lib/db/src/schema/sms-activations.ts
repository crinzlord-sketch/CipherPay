import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const smsActivationsTable = pgTable("sms_activations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  activationId: text("activation_id").notNull().unique(),
  number: text("number").notNull(),
  service: text("service").notNull(),
  country: text("country").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  code: text("code"),
  transactionId: integer("transaction_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSmsActivationSchema = createInsertSchema(smsActivationsTable).omit({ id: true, createdAt: true });
export type InsertSmsActivation = z.infer<typeof insertSmsActivationSchema>;
export type SmsActivation = typeof smsActivationsTable.$inferSelect;
