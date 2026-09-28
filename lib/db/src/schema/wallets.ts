import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletsTable = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull().default("0"),
  ledgerBalance: numeric("ledger_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("NGN"),
  // Tracks how much of the user's balance is held in their Flutterwave subaccount.
  // Funded via split payments; debited via debit_subaccount on withdrawals.
  // Allows the withdrawal route to decide whether to use debit_subaccount.
  flwSubaccountBalance: numeric("flw_subaccount_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  // Flutterwave Payout Subaccount (PSA) — the user's actual provider wallet.
  flwPsaId: integer("flw_psa_id"),
  flwPsaAccountReference: text("flw_psa_account_reference"),
  flwPsaBarterId: text("flw_psa_barter_id"),
  flwPsaStaticAccount: text("flw_psa_static_account"),
  flwPsaBankCode: text("flw_psa_bank_code"),
  flwPsaBankName: text("flw_psa_bank_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({ id: true, updatedAt: true });
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof walletsTable.$inferSelect;
