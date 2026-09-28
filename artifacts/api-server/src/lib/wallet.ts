import { db, walletsTable, transactionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateReference } from "./auth";

export async function getOrCreateWallet(userId: number) {
  let [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (!wallet) {
    [wallet] = await db.insert(walletsTable).values({ userId, balance: "0", ledgerBalance: "0", currency: "NGN" }).returning();
  }
  return wallet;
}

export async function creditWallet(userId: number, amount: number, description: string, type: string, metadata?: object) {
  const wallet = await getOrCreateWallet(userId);
  const balanceBefore = parseFloat(wallet.balance);
  const balanceAfter = balanceBefore + amount;

  await db.update(walletsTable).set({ balance: balanceAfter.toFixed(2), ledgerBalance: balanceAfter.toFixed(2) }).where(eq(walletsTable.userId, userId));

  const [tx] = await db.insert(transactionsTable).values({
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
}

export async function debitWallet(userId: number, amount: number, description: string, type: string, metadata?: object) {
  const wallet = await getOrCreateWallet(userId);
  const balanceBefore = parseFloat(wallet.balance);

  if (balanceBefore < amount) {
    throw new Error("Insufficient balance");
  }

  const balanceAfter = balanceBefore - amount;
  await db.update(walletsTable).set({ balance: balanceAfter.toFixed(2), ledgerBalance: balanceAfter.toFixed(2) }).where(eq(walletsTable.userId, userId));

  const [tx] = await db.insert(transactionsTable).values({
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
}

export function formatWallet(wallet: typeof walletsTable.$inferSelect) {
  return {
    id: wallet.id,
    userId: wallet.userId,
    balance: parseFloat(wallet.balance),
    ledgerBalance: parseFloat(wallet.ledgerBalance),
    currency: wallet.currency,
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
