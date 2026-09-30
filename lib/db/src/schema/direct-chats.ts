import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, boolean } from "drizzle-orm/pg-core";

export const directChatsTable = pgTable("direct_chats", {
  id: serial("id").primaryKey(),
  userOneId: integer("user_one_id").notNull(),
  userTwoId: integer("user_two_id").notNull(),
  backgroundOne: text("background_one"),
  backgroundTwo: text("background_two"),
  deletedOne: boolean("deleted_one").notNull().default(false),
  deletedTwo: boolean("deleted_two").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pair: uniqueIndex("direct_chats_pair_unique").on(t.userOneId, t.userTwoId),
  byOne: index("direct_chats_one_idx").on(t.userOneId, t.lastMessageAt),
  byTwo: index("direct_chats_two_idx").on(t.userTwoId, t.lastMessageAt),
}));

export const directMessagesTable = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  senderId: integer("sender_id").notNull(),
  body: text("body"),
  imageUrl: text("image_url"),
  gifUrl: text("gif_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byChat: index("direct_messages_chat_idx").on(t.chatId, t.id),
}));

export const blockedUsersTable = pgTable("blocked_users", {
  id: serial("id").primaryKey(),
  blockerId: integer("blocker_id").notNull(),
  blockedId: integer("blocked_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pair: uniqueIndex("blocked_users_pair_unique").on(t.blockerId, t.blockedId),
}));

export type DirectChat = typeof directChatsTable.$inferSelect;
export type DirectMessage = typeof directMessagesTable.$inferSelect;
