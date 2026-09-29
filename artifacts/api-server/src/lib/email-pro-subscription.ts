import { and, eq, lte } from "drizzle-orm";
import { db, emailProSubscriptionsTable } from "@workspace/db";
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
      await debitWallet(row.userId, EMAIL_PRO_MONTHLY_FEE, "Email Pro — monthly renewal", "service", {
        service: "email_pro", fee: EMAIL_PRO_MONTHLY_FEE,
      });
      const nextBillingAt = nextMonth(row.nextBillingAt);
      await db.update(emailProSubscriptionsTable).set({
        nextBillingAt, lastChargedAt: now, updatedAt: now,
      }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")));
    } catch {
      await db.update(emailProSubscriptionsTable).set({
        status: "locked", lockedAt: now, updatedAt: now,
      }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")));
    }
  }
}
