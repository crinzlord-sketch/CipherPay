import { db, transactionsTable, usersTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

export interface KycLimit {
  maxPerTx: number;
  maxDailyDeposit: number;
  label: string;
}

export const MAX_DEPOSIT_AMOUNT = 90_000_000;

export const KYC_LIMITS: Record<number, KycLimit> = {
  0: { maxPerTx: 5_000,      maxDailyDeposit: 5_000,       label: "Unverified" },
  1: { maxPerTx: 50_000,     maxDailyDeposit: 50_000,      label: "Basic (BVN/NIN)" },
  2: { maxPerTx: MAX_DEPOSIT_AMOUNT, maxDailyDeposit: MAX_DEPOSIT_AMOUNT, label: "Advanced" },
  3: { maxPerTx: MAX_DEPOSIT_AMOUNT, maxDailyDeposit: MAX_DEPOSIT_AMOUNT, label: "Advanced" },
};

export function getKycLimit(level: number): KycLimit {
  return KYC_LIMITS[Math.max(0, Math.min(3, level ?? 0))];
}

// Admins get level 99 — bypasses all KYC limits everywhere.
export const ADMIN_KYC_LEVEL = 99;

export async function getUserKycLevel(userId: number): Promise<number> {
  const [row] = await db.select({ kycLevel: usersTable.kycLevel, isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId));
  if (row?.isAdmin) return ADMIN_KYC_LEVEL;
  return row?.kycLevel ?? 0;
}

export async function getTodayDepositTotal(userId: number): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount::numeric), 0)` })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.userId, userId),
        eq(transactionsTable.type, "fund"),
        eq(transactionsTable.status, "success"),
        gte(transactionsTable.createdAt, todayStart),
      ),
    );
  return parseFloat(row?.total ?? "0");
}

export function checkPerTxLimitSync(level: number, amount: number): string | null {
  if (level >= ADMIN_KYC_LEVEL) return null;
  const limits = getKycLimit(level);
  if (amount > limits.maxPerTx) {
    return `Your ${limits.label} account allows a maximum of ₦${limits.maxPerTx.toLocaleString()} per transaction. Upgrade your KYC to increase this limit.`;
  }
  return null;
}

export function getDepositFlagReason(kycLevel: number, amount: number): string | null {
  if (kycLevel >= ADMIN_KYC_LEVEL) return null;
  const limits = getKycLimit(kycLevel);
  if (amount > limits.maxPerTx) {
    return `Deposit exceeds the ${limits.label} limit of ₦${limits.maxPerTx.toLocaleString()}. Complete the next KYC level before this deposit can be released.`;
  }
  return null;
}

export async function checkDepositLimit(userId: number, kycLevel: number, amount: number): Promise<string | null> {
  if (amount > MAX_DEPOSIT_AMOUNT) {
    return `The maximum deposit is ₦${MAX_DEPOSIT_AMOUNT.toLocaleString()}.`;
  }
  return null;
}
