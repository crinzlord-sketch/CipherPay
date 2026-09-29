import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailProSubscriptionsTable = pgTable("email_pro_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  nextBillingAt: timestamp("next_billing_at", { withTimezone: true }).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastChargedAt: timestamp("last_charged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  byStatusBilling: index("email_pro_status_billing_idx").on(table.status, table.nextBillingAt),
}));

export type EmailProSubscription = typeof emailProSubscriptionsTable.$inferSelect;
