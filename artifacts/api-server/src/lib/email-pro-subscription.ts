import { and, eq, lte } from "drizzle-orm";
import { db, emailProSubscriptionsTable, transactionsTable, walletsTable } from "@workspace/db";
import { generateReference } from "./auth";
import { debitWallet } from "./wallet";

export const EMAIL_PRO_UNLOCK_FEE = 5000;
export const EMAIL_PRO_MONTHLY_FEE = 5000;

function nextMonth(from: Date): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export async function getEmailProSubscription(userId: number) {
  const [row] = await db.select().from(emailProSubscriptionsTable).where(eq(emailProSubscriptionsTable.userId, userId));
  return row ?? null;
}

export async function hasActiveEmailPro(userId: number): Promise<boolean> {
  const row = await getEmailProSubscription(userId);
  return row?.status === "active" && row.nextBillingAt > new Date();
}

export async function unlockEmailPro(userId: number): Promise<{ nextBillingAt: Date }> {
  const existing = await getEmailProSubscription(userId);
  if (existing?.status === "active" && existing.nextBillingAt > new Date()) return { nextBillingAt: existing.nextBillingAt };

  const now = new Date();
  const { tx } = await debitWallet(userId, EMAIL_PRO_UNLOCK_FEE, "Email Pro — first month", "service", {
    service: "email_pro", fee: EMAIL_PRO_UNLOCK_FEE,
  });
  const nextBillingAt = nextMonth(now);
  if (existing) {
    await db.update(emailProSubscriptionsTable).set({
      status: "active", activatedAt: now, nextBillingAt, lockedAt: null,
      lastChargedAt: now, updatedAt: now,
    }).where(eq(emailProSubscriptionsTable.userId, userId));
  } else {
    await db.insert(emailProSubscriptionsTable).values({
      userId, status: "active", activatedAt: now, nextBillingAt, lastChargedAt: now,
    });
  }
  return { nextBillingAt };
}

export async function renewDueEmailProSubscriptions(): Promise<void> {
  const now = new Date();
  const rows = await db.select().from(emailProSubscriptionsTable)
    .where(and(eq(emailProSubscriptionsTable.status, "active"), lte(emailProSubscriptionsTable.nextBillingAt, now)));

  for (const row of rows) {
    try {
      const nextBillingAt = nextMonth(row.nextBillingAt);
      await db.transaction(async (database) => {
        const [wallet] = await database.select().from(walletsTable).where(eq(walletsTable.userId, row.userId)).limit(1);
        if (!wallet) throw new Error("Wallet not found");
        const before = parseFloat(wallet.balance);
        if (before < EMAIL_PRO_MONTHLY_FEE) throw new Error("Insufficient balance");
        const after = before - EMAIL_PRO_MONTHLY_FEE;
        await database.update(walletsTable).set({ balance: after.toFixed(2), ledgerBalance: after.toFixed(2) }).where(eq(walletsTable.userId, row.userId));
        await database.insert(transactionsTable).values({ userId: row.userId, type: "service", amount: EMAIL_PRO_MONTHLY_FEE.toFixed(2), status: "success", reference: generateReference("DR"), description: "Email Pro — monthly renewal", metadata: JSON.stringify({ service: "email_pro", fee: EMAIL_PRO_MONTHLY_FEE }), balanceBefore: before.toFixed(2), balanceAfter: after.toFixed(2) });
        await database.update(emailProSubscriptionsTable).set({ nextBillingAt, lastChargedAt: now, updatedAt: now }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")));
      });
    } catch {
      await db.update(emailProSubscriptionsTable).set({
        status: "locked", lockedAt: now, updatedAt: now,
      }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")));
    }
  }
}
