import { pgTable, serial, integer, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const emailAccountsTable = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  replyTo: text("reply_to"),
  host: text("host").notNull(),
  port: integer("port").notNull().default(465),
  secure: boolean("secure").notNull().default(true),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  byUser: index("email_accounts_user_idx").on(table.userId, table.updatedAt),
  uniqueMailbox: uniqueIndex("email_accounts_user_mailbox_uq").on(table.userId, table.email, table.username, table.host),
}));

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  accountId: integer("account_id").references(() => emailAccountsTable.id, { onDelete: "set null" }),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  replyTo: text("reply_to"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  contentType: text("content_type").notNull().default("text"),
  recipientCount: integer("recipient_count").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0),
  status: text("status").notNull().default("sending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  byUser: index("email_campaigns_user_idx").on(table.userId, table.createdAt),
}));

export const emailRecipientsTable = pgTable("email_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("queued"),
  smtpMessageId: text("smtp_message_id"),
  error: text("error"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  byCampaign: index("email_recipients_campaign_idx").on(table.campaignId, table.createdAt),
}));

export const insertEmailAccountSchema = createInsertSchema(emailAccountsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccountsTable.$inferSelect;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;
export type EmailRecipient = typeof emailRecipientsTable.$inferSelect;