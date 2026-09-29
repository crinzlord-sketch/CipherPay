import { and, eq, lte, sql } from "drizzle-orm";
import { db, emailProSubscriptionsTable, transactionsTable, walletsTable } from "@workspace/db";
import { generateReference } from "./auth";
import { getOrCreateWallet } from "./wallet";
import { logger } from "./logger";

export const EMAIL_PRO_UNLOCK_FEE = 3000;
export const EMAIL_PRO_MONTHLY_FEE = 3000;

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
  if (existing?.status === "active" && existing.nextBillingAt > new Date()) {
    return { nextBillingAt: existing.nextBillingAt };
  }

  await getOrCreateWallet(userId);
  const now = new Date();
  const nextBillingAt = nextMonth(now);

  return db.transaction(async (database) => {
    const [updatedWallet] = await database.update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} - ${EMAIL_PRO_UNLOCK_FEE.toFixed(2)}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} - ${EMAIL_PRO_UNLOCK_FEE.toFixed(2)}`,
      })
      .where(sql`${walletsTable.userId} = ${userId} AND ${walletsTable.balance} >= ${EMAIL_PRO_UNLOCK_FEE.toFixed(2)}`)
      .returning({ balance: walletsTable.balance });

    if (!updatedWallet) throw new Error("Insufficient balance");

    const balanceAfter = parseFloat(updatedWallet.balance);
    const balanceBefore = balanceAfter + EMAIL_PRO_UNLOCK_FEE;

    await database.insert(transactionsTable).values({
      userId,
      type: "service",
      amount: EMAIL_PRO_UNLOCK_FEE.toFixed(2),
      status: "success",
      reference: generateReference("DR"),
      description: "Email Pro — first month",
      metadata: JSON.stringify({ service: "email_pro", fee: EMAIL_PRO_UNLOCK_FEE }),
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
    });

    if (existing) {
      const updated = await database.update(emailProSubscriptionsTable).set({
        status: "active",
        activatedAt: now,
        nextBillingAt,
        lockedAt: null,
        lastChargedAt: now,
        updatedAt: now,
      }).where(eq(emailProSubscriptionsTable.userId, userId)).returning({ id: emailProSubscriptionsTable.id });
      if (updated.length === 0) throw new Error("Email Pro subscription could not be updated");
    } else {
      await database.insert(emailProSubscriptionsTable).values({
        userId, status: "active", activatedAt: now, nextBillingAt, lastChargedAt: now,
      });
    }

    return { nextBillingAt };
  });
}

export async function renewDueEmailProSubscriptions(): Promise<void> {
  const now = new Date();
  const rows = await db.select().from(emailProSubscriptionsTable)
    .where(and(eq(emailProSubscriptionsTable.status, "active"), lte(emailProSubscriptionsTable.nextBillingAt, now)));

  for (const row of rows) {
    let insufficientBalance = false;

    try {
      const nextBillingAt = nextMonth(row.nextBillingAt);
      await db.transaction(async (database) => {
        const [updatedWallet] = await database.update(walletsTable)
          .set({
            balance: sql`${walletsTable.balance} - ${EMAIL_PRO_MONTHLY_FEE.toFixed(2)}`,
            ledgerBalance: sql`${walletsTable.ledgerBalance} - ${EMAIL_PRO_MONTHLY_FEE.toFixed(2)}`,
          })
          .where(sql`${walletsTable.userId} = ${row.userId} AND ${walletsTable.balance} >= ${EMAIL_PRO_MONTHLY_FEE.toFixed(2)}`)
          .returning({ balance: walletsTable.balance });

        if (!updatedWallet) {
          insufficientBalance = true;
          throw new Error("Insufficient balance");
        }

        const balanceAfter = parseFloat(updatedWallet.balance);
        const balanceBefore = balanceAfter + EMAIL_PRO_MONTHLY_FEE;

        await database.insert(transactionsTable).values({
          userId: row.userId,
          type: "service",
          amount: EMAIL_PRO_MONTHLY_FEE.toFixed(2),
          status: "success",
          reference: generateReference("DR"),
          description: "Email Pro — monthly renewal",
          metadata: JSON.stringify({ service: "email_pro", fee: EMAIL_PRO_MONTHLY_FEE }),
          balanceBefore: balanceBefore.toFixed(2),
          balanceAfter: balanceAfter.toFixed(2),
        });

        const renewed = await database.update(emailProSubscriptionsTable).set({
          nextBillingAt,
          lastChargedAt: now,
          updatedAt: now,
        }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")))
          .returning({ id: emailProSubscriptionsTable.id });

        if (renewed.length === 0) throw new Error("Subscription was already processed");
      });
    } catch (error: any) {
      if (insufficientBalance) {
        await db.update(emailProSubscriptionsTable).set({
          status: "locked", lockedAt: now, updatedAt: now,
        }).where(and(eq(emailProSubscriptionsTable.id, row.id), eq(emailProSubscriptionsTable.status, "active")));
      } else {
        logger.error({ userId: row.userId, subscriptionId: row.id, err: error?.message }, "Email Pro renewal failed");
      }
    }
  }
}
