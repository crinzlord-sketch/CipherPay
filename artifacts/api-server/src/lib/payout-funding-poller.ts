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
          logger.info({ accountReference: row.accountReference, transactionCount: transactions.length, transactions: transactions.map((tx: any) => ({ id: tx?.id, status: tx?.status, debitCurrency: tx?.debit_currency, currency: tx?.currency, amount: tx?.amount, reference: tx?.reference, accountNumber: tx?.account_number, narration: tx?.narration })) }, "payout funding poll checked wallet");
          for (const tx of transactions) {
            const status = String(tx?.status ?? "").toUpperCase();
            const debitCurrency = String(tx?.debit_currency ?? "").toUpperCase();
            const narration = String(tx?.narration ?? "").trim().toUpperCase();

            // The PSA transaction-history endpoint does not reliably include
            // debit_currency, even though the wallet-funding webhook does.
            // Because this query is already scoped to a specific PSA wallet,
            // use Flutterwave's WALLET FUNDING narration as the fallback signal.
            // This prevents legitimate bank deposits from being silently skipped.
            const reference = String(tx?.reference ?? "").trim();
            const amount = Number(tx?.amount ?? 0);

            // Flutterwave's PSA transaction-history response is inconsistent:
            // for bank deposits it can omit status, debit_currency, and narration.
            // The history is already scoped to this specific PSA wallet. For
            // reconciliation, treat a positive transaction as funding when it is
            // explicitly marked as WALLET FUNDING / PSA, or when it has no
            // classification fields and is not one of CipherPay's own outgoing
            // CP-* transfer references. Outgoing CipherPay transfers always use
            // CP-* references, so they must never be credited as deposits.
            const explicitlyWalletFunding =
              narration === "WALLET FUNDING" || debitCurrency === "PSA";
            const unclassifiedIncomingTransfer =
              amount > 0 &&
              !status &&
              !debitCurrency &&
              !narration &&
              Boolean(reference) &&
              !reference.toUpperCase().startsWith("CP-");

            const isWalletFunding = explicitlyWalletFunding || unclassifiedIncomingTransfer;

            if (amount <= 0 || !isWalletFunding) continue;
            if (status && status !== "SUCCESSFUL") continue;

            await handleEvent({ log: logger } as any, {
              event: "transfer.completed",
              data: {
                ...tx,
                debit_currency: debitCurrency || "PSA",
              },
            }, row.accountReference);
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