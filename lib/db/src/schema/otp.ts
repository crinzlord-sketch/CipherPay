import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const otpTable = pgTable("otp", {
  id: serial("id").primaryKey(),
  target: text("target").notNull(), // email or phone
  code: text("code").notNull(),
  purpose: text("purpose").notNull().default("verification"),
  used: boolean("used").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOtpSchema = createInsertSchema(otpTable).omit({ id: true, createdAt: true });
export type InsertOtp = z.infer<typeof insertOtpSchema>;
export type Otp = typeof otpTable.$inferSelect;
