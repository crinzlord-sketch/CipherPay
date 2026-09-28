import { db, transactionsTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { verifyBill } from "./flutterwave";
import { notifyUser } from "./notifications";
import { logger } from "./logger";

async function checkPendingTokens(): Promise<void> {
  // Fetch bill transactions created in the last 2 hours with status "success"
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let rows: (typeof transactionsTable.$inferSelect)[];
  try {
    rows = await db.select().from(transactionsTable).where(
      and(
        eq(transactionsTable.type, "bill"),
        eq(transactionsTable.status, "success"),
        gte(transactionsTable.createdAt, cutoff),
      ),
    );
  } catch (e: any) {
    logger.warn({ err: e?.message }, "electricity-token-job: DB query failed");
    return;
  }

  // Filter to those with tokenPending: true in their metadata
  const pending = rows.filter((r) => {
    try {
      const m = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {});
      return (m as any).tokenPending === true;
    } catch { return false; }
  });

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, "electricity-token-job: checking pending tokens");

  for (const tx of pending) {
    try {
      const meta = typeof tx.metadata === "string" ? JSON.parse(tx.metadata) : (tx.metadata ?? {}) as any;
      const providerRef: string | undefined = meta.providerRef;
      if (!providerRef) continue;

      let token: string | null = null;
      try {
        const v = await verifyBill(providerRef);
        token = v.raw?.data?.token ?? v.raw?.data?.extra ?? null;
      } catch (e: any) {
        logger.warn({ err: e?.message, txId: tx.id }, "electricity-token-job: verify failed");
        continue;
      }

      if (!token) continue;

      // Token has arrived — persist it and fire a notification
      const updatedMeta = { ...meta, token, tokenPending: false };
      await db.update(transactionsTable)
        .set({ metadata: JSON.stringify(updatedMeta) })
        .where(eq(transactionsTable.id, tx.id));

      logger.info({ txId: tx.id, userId: tx.userId }, "electricity-token-job: token delivered, notifying user");

      await notifyUser({
        userId: tx.userId,
        type: "success",
        title: "⚡ Electricity token ready",
        body: `Your prepaid token is: ${token}. Tap to view and copy it.`,
        link: `/transactions/${tx.id}`,
      }).catch(() => {});
    } catch (e: any) {
      logger.warn({ err: e?.message, txId: tx.id }, "electricity-token-job: error processing tx");
    }
  }
}

export function startElectricityTokenJob(): void {
  setTimeout(() => { void checkPendingTokens(); }, 15_000);
  setInterval(() => { void checkPendingTokens(); }, 30_000);
  logger.info("Electricity token job started — checks every 30s");
}
