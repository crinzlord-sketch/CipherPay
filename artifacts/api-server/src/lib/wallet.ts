import { db, walletsTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateReference } from "./auth";

export async function getOrCreateWallet(userId: number) {
  await db.insert(walletsTable)
    .values({ userId, balance: "0", ledgerBalance: "0", currency: "NGN" })
    .onConflictDoNothing({ target: walletsTable.userId });

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (!wallet) throw new Error("Could not create wallet");
  return wallet;
}

export async function creditWallet(userId: number, amount: number, description: string, type: string, metadata?: object) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Credit amount must be greater than zero");
  await getOrCreateWallet(userId);

  return db.transaction(async (database) => {
    const [updated] = await database.update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} + ${amount.toFixed(2)}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} + ${amount.toFixed(2)}`,
      })
      .where(eq(walletsTable.userId, userId))
      .returning({ balance: walletsTable.balance });

    if (!updated) throw new Error("Wallet could not be credited");

    const balanceAfter = parseFloat(updated.balance);
    const balanceBefore = balanceAfter - amount;

    const [tx] = await database.insert(transactionsTable).values({
      userId,
      type,
      amount: amount.toFixed(2),
      status: "success",
      reference: generateReference("CR"),
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
    }).returning();

    return { tx, balanceAfter };
  });
}

export async function debitWallet(userId: number, amount: number, description: string, type: string, metadata?: object) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Debit amount must be greater than zero");
  await getOrCreateWallet(userId);

  return db.transaction(async (database) => {
    const [updated] = await database.update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} - ${amount.toFixed(2)}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} - ${amount.toFixed(2)}`,
      })
      .where(sql`${walletsTable.userId} = ${userId} AND ${walletsTable.balance} >= ${amount.toFixed(2)}`)
      .returning({ balance: walletsTable.balance });

    if (!updated) throw new Error("Insufficient balance");

    const balanceAfter = parseFloat(updated.balance);
    const balanceBefore = balanceAfter + amount;

    const [tx] = await database.insert(transactionsTable).values({
      userId,
      type,
      amount: amount.toFixed(2),
      status: "success",
      reference: generateReference("DR"),
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
    }).returning();

    return { tx, balanceAfter };
  });
}

export function formatWallet(wallet: typeof walletsTable.$inferSelect) {
  return {
    id: wallet.id,
    userId: wallet.userId,
    balance: parseFloat(wallet.balance),
    ledgerBalance: parseFloat(wallet.ledgerBalance),
    currency: wallet.currency,
    depositAccount: wallet.flwPsaStaticAccount ? {
      accountNumber: wallet.flwPsaStaticAccount,
      bankName: wallet.flwPsaBankName ?? "Flutterwave",
      bankCode: wallet.flwPsaBankCode ?? "",
      permanent: true,
    } : null,
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function formatTransaction(tx: typeof transactionsTable.$inferSelect) {
  return {
    id: tx.id,
    userId: tx.userId,
    type: tx.type,
    amount: parseFloat(tx.amount),
    fee: tx.fee ? parseFloat(tx.fee) : null,
    status: tx.status,
    reference: tx.reference,
    description: tx.description,
    metadata: tx.metadata,
    balanceBefore: tx.balanceBefore ? parseFloat(tx.balanceBefore) : null,
    balanceAfter: tx.balanceAfter ? parseFloat(tx.balanceAfter) : null,
    isFlagged: tx.isFlagged,
    flagReason: tx.flagReason,
    createdAt: tx.createdAt.toISOString(),
  };
}
