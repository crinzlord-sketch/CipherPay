import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const socialOrdersTable = pgTable("social_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  serviceId: text("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  platform: text("platform").notNull(),
  link: text("link").notNull(),
  quantity: integer("quantity").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  startCount: integer("start_count").notNull().default(0),
  remainsCount: integer("remains_count").notNull().default(0),
  externalOrderId: text("external_order_id"),
  transactionId: integer("transaction_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSocialOrderSchema = createInsertSchema(socialOrdersTable).omit({ id: true, createdAt: true });
export type InsertSocialOrder = z.infer<typeof insertSocialOrderSchema>;
export type SocialOrder = typeof socialOrdersTable.$inferSelect;
