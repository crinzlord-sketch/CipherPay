import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userEmailEventsTable = pgTable("user_email_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  subject: text("subject").notNull(),
}, (table) => ({
  uniqueUserKind: uniqueIndex("user_email_events_user_kind_uq").on(table.userId, table.kind),
  byKindDate: index("user_email_events_kind_date_idx").on(table.kind, table.sentAt),
}));
