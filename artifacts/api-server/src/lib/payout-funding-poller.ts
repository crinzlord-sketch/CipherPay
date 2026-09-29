import { isNotNull } from "drizzle-orm";
import { db, walletsTable } from "@workspace/db";
import { fetchPayoutWalletTransactions } from "./flutterwave";
import { handleEvent } from "../routes/webhooks";
import { logger } from "./logger";

let running = false;

export function startPayoutFundingPoller(): void {
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await db.select({ accountReference: walletsTable.flwPsaAccountReference })
        .from(walletsTable)
        .where(isNotNull(walletsTable.flwPsaAccountReference));
      for (const row of rows) {
        if (!row.accountReference) continue;
        try {
          const transactions = await fetchPayoutWalletTransactions(row.accountReference);
          logger.info({ accountReference: row.accountReference, transactionCount: transactions.length }, "payout funding poll checked wallet");
          for (const tx of transactions) {
            const status = String(tx?.status ?? "").toUpperCase();
            const debitCurrency = String(tx?.debit_currency ?? "").toUpperCase();
            if (status !== "SUCCESSFUL" || debitCurrency !== "PSA") continue;
            await handleEvent({ log: logger } as any, {
              event: "transfer.completed",
              data: tx,
            });
          }
        } catch (e: any) {
          logger.warn({ err: e?.message, accountReference: row.accountReference }, "payout funding poll failed");
        }
      }
    } catch (e: any) {
      logger.error({ err: e?.message }, "payout funding poller failed");
    } finally {
      running = false;
    }
  };
  void poll();
  setInterval(() => void poll(), 30_000);
}
