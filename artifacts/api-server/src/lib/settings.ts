import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface DepositAccountSettings {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

const DEPOSIT_ACCOUNT_KEY = "deposit_account";

// Fallback used until an admin sets a custom account. Kept here so the manual
// deposit flow always has a valid destination even on a fresh database.
export const DEFAULT_DEPOSIT_ACCOUNT: DepositAccountSettings = {
  bankName: "OPay",
  accountNumber: "6559019264",
  accountName: "ETEOWO PATRICK UDO",
};

export async function getDepositAccount(): Promise<DepositAccountSettings> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, DEPOSIT_ACCOUNT_KEY));
  if (!row) return DEFAULT_DEPOSIT_ACCOUNT;
  try {
    const parsed = JSON.parse(row.value) as Partial<DepositAccountSettings>;
    return {
      bankName: parsed.bankName?.trim() || DEFAULT_DEPOSIT_ACCOUNT.bankName,
      accountNumber: parsed.accountNumber?.trim() || DEFAULT_DEPOSIT_ACCOUNT.accountNumber,
      accountName: parsed.accountName?.trim() || DEFAULT_DEPOSIT_ACCOUNT.accountName,
    };
  } catch {
    return DEFAULT_DEPOSIT_ACCOUNT;
  }
}

export async function setDepositAccount(account: DepositAccountSettings): Promise<DepositAccountSettings> {
  const value = JSON.stringify(account);
  await db
    .insert(appSettingsTable)
    .values({ key: DEPOSIT_ACCOUNT_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
  return account;
}
