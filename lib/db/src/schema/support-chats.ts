import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

export const supportChatsTable = pgTable("support_chats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("ai"),
  subject: text("subject"),
  assignedAdminId: integer("assigned_admin_id"),
  unreadForUser: integer("unread_for_user").notNull().default(0),
  unreadForAdmin: integer("unread_for_admin").notNull().default(0),
  userTypingAt: timestamp("user_typing_at", { withTimezone: true }),
  agentTypingAt: timestamp("agent_typing_at", { withTimezone: true }),
  // 1–5 star rating submitted by the user when they end the chat
  rating: integer("rating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index("support_chats_user_idx").on(t.userId, t.status),
  byStatus: index("support_chats_status_idx").on(t.status, t.lastMessageAt),
}));

export const supportMessagesTable = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull()
    .references(() => supportChatsTable.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  body: text("body").notNull(),
  // Optional image attached to the message — stored as a server-relative URL
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byChat: index("support_messages_chat_idx").on(t.chatId, t.id),
}));

export type SupportChat = typeof supportChatsTable.$inferSelect;
export type SupportMessage = typeof supportMessagesTable.$inferSelect;
