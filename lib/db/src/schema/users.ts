import { pgTable, serial, text, boolean, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  avatarUrl: text("avatar_url"),
  gender: text("gender"),
  accountNumber: text("account_number").unique(),
  isVerified: boolean("is_verified").notNull().default(false),
  kycLevel: integer("kyc_level").notNull().default(0),
  referralCode: text("referral_code").notNull(),
  referredBy: text("referred_by"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isSuspended: boolean("is_suspended").notNull().default(false),
  suspendReason: text("suspend_reason"),
  pinHash: text("pin_hash"),
  pinUpdatedAt: timestamp("pin_updated_at", { withTimezone: true }),
  flwSubaccountId: text("flw_subaccount_id"),
  // Numeric Flutterwave subaccount id (body.data.id from subaccount creation).
  // The string subaccount_id ("RS_xxx") is used for split-payment charges;
  // the numeric id is what debit_subaccount expects in POST /v3/transfers.
  flwSubaccountNumericId: integer("flw_subaccount_numeric_id"),
  // Expo push token for sending locked-screen push notifications.
  expoPushToken: text("expo_push_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
