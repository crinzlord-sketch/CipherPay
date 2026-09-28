import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const temporaryInboxesTable = pgTable("temporary_inboxes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  slot: integer("slot").notNull(),
  address: text("address").notNull(),
  inboxId: text("inbox_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  byUser: index("temporary_inboxes_user_idx").on(table.userId, table.createdAt),
  dueRenewal: index("temporary_inboxes_renewal_idx").on(table.status, table.expiresAt),
  oneInboxPerSlot: uniqueIndex("temporary_inboxes_user_slot_uq").on(table.userId, table.slot),
  validSlot: check("temporary_inboxes_slot_check", sql`${table.slot} in (1, 2)`),
}));

export const insertTemporaryInboxSchema = createInsertSchema(temporaryInboxesTable)
  .omit({ id: true, createdAt: true });

export type InsertTemporaryInbox = z.infer<typeof insertTemporaryInboxSchema>;
export type TemporaryInbox = typeof temporaryInboxesTable.$inferSelect;