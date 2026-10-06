import { db, walletsTable, transactionsTable } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateReference } from "./auth";
import { verifyByReference } from "./flutterwave";

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


/**
 * Reconcile a Flutterwave wallet-funding transaction directly against Flutterwave.
 * This is the server-side fallback when a webhook is delayed/missed.
 *
 * The status transition is CAS-guarded (pending -> success) inside the same DB
 * transaction as the wallet credit, so webhook + polling + manual verification
 * can safely race without ever crediting the same funding twice.
 */
export async function creditFlutterwaveFunding(
  reference: string,
  expectedProvider?: { amount: number; currency: string; orderNo?: string },
) {
  const [tx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.type, "fund")))
    .limit(1);

  if (!tx) throw new Error("Funding transaction not found");
  if (tx.status === "success") return { credited: false, alreadyCredited: true, held: false };
  if (tx.status === "failed") return { credited: false, alreadyCredited: false, held: false };

  const provider = expectedProvider ?? await verifyByReference(reference);
  const providerStatus = String(provider.status ?? "").toLowerCase();
  const amount = Number(provider.amount);
  const currency = String(provider.currency ?? "NGN").toUpperCase();
  const expectedAmount = Number(tx.amount);

  if (!["successful", "success", "completed", "succeeded"].includes(providerStatus)) {
    if (["failed", "cancelled", "canceled", "reversed"].includes(providerStatus)) {
      await db.update(transactionsTable).set({ status: "failed" })
        .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")));
      return { credited: false, alreadyCredited: false, held: false, failed: true };
    }
    return { credited: false, alreadyCredited: false, held: false, pending: true };
  }

  if (String(provider.tx_ref ?? reference) !== reference) {
    throw new Error("Flutterwave reference mismatch");
  }
  if (currency !== "NGN") throw new Error("Flutterwave currency mismatch");
  if (!Number.isFinite(amount) || amount + 0.001 < expectedAmount) {
    throw new Error("Flutterwave amount mismatch");
  }

  if (tx.isFlagged) {
    return { credited: false, alreadyCredited: false, held: true };
  }

  return db.transaction(async (database) => {
    const [updated] = await database.update(transactionsTable)
      .set({ status: "success" })
      .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });

    if (!updated) {
      const [current] = await database.select({ status: transactionsTable.status })
        .from(transactionsTable).where(eq(transactionsTable.id, tx.id)).limit(1);
      return {
        credited: false,
        alreadyCredited: current?.status === "success",
        held: false,
      };
    }

    const [wallet] = await database.update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} + ${expectedAmount.toFixed(2)}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} + ${expectedAmount.toFixed(2)}`,
      })
      .where(eq(walletsTable.userId, tx.userId))
      .returning({ balance: walletsTable.balance });

    if (!wallet) throw new Error("Wallet could not be credited");

    const balanceAfter = parseFloat(wallet.balance);
    const balanceBefore = balanceAfter - expectedAmount;
    await database.update(transactionsTable)
      .set({
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        metadata: JSON.stringify({
          ...(JSON.parse(tx.metadata ?? "{}")),
          provider: "flutterwave",
          providerVerified: true,
          providerAmount: amount,
          providerCurrency: currency,
          verifiedAt: new Date().toISOString(),
        }),
      })
      .where(eq(transactionsTable.id, tx.id));

    return { credited: true, alreadyCredited: false, held: false, balanceAfter };
  });
}

/**
 * Background safety net for pending Flutterwave fundings.
 * Webhooks remain the primary path, but a missed/delayed webhook can no longer
 * leave a successful bank/card payment stuck indefinitely.
 */
export async function reconcilePendingFlutterwaveFundings(limit = 50) {
  const rows = await db.select({
    id: transactionsTable.id,
    reference: transactionsTable.reference,
    metadata: transactionsTable.metadata,
  }).from(transactionsTable)
    .where(and(eq(transactionsTable.type, "fund"), eq(transactionsTable.status, "pending")))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);

  let checked = 0;
  let credited = 0;
  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.metadata ?? "{}"); } catch { /* ignore */ }
    if (String(meta.provider ?? "").toLowerCase() !== "flutterwave") continue;
    checked++;
    try {
      const result = await creditFlutterwaveFunding(row.reference);
      if (result.credited) credited++;
    } catch {
      // Keep the transaction pending when Flutterwave has not produced a
      // verifiable successful result yet. The next pass will retry it.
    }
  }
  return { checked, credited };
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
