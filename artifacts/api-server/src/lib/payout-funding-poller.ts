import { isNotNull, eq, sql } from "drizzle-orm";
import { db, walletsTable, transactionsTable, usersTable } from "@workspace/db";
import { fetchPayoutWalletTransactions, movePayoutWalletToMerchant, findTransferByReference } from "./flutterwave";
import { handleEvent } from "../routes/webhooks";
import { logger } from "./logger";
import { getDepositFlagReason } from "./kycLimits";
import { notifyUser } from "./notifications";

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
          // Flutterwave can expose a separate small positive history row for the
          // funding fee with the same reference as the actual deposit. When the
          // classification fields are missing, only reconcile the largest amount
          // for that reference; never turn the provider fee into wallet credit.
          const largestAmountByReference = new Map<string, number>();
          for (const item of transactions) {
            const ref = String(item?.reference ?? "").trim();
            const amount = Number(item?.amount ?? 0);
            if (ref && amount > 0) largestAmountByReference.set(ref, Math.max(largestAmountByReference.get(ref) ?? 0, amount));
          }
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
              !reference.toUpperCase().startsWith("CP-") &&
              amount >= (largestAmountByReference.get(reference) ?? amount);

            const isWalletFunding = explicitlyWalletFunding || unclassifiedIncomingTransfer;

            if (amount <= 0 || !isWalletFunding) continue;
            if (status && status !== "SUCCESSFUL") continue;

            // Reconcile directly from the PSA account reference. This avoids
            // relying on Flutterwave's transaction-history account_number,
            // which can describe the sender rather than the destination PSA.
            // The provider reference is the idempotency key, so a webhook and
            // this poller can safely observe the same deposit concurrently.
            const providerReference = reference;
            const [walletRow] = await db.select({
              wallet: walletsTable,
              user: usersTable,
            }).from(walletsTable)
              .innerJoin(usersTable, eq(usersTable.id, walletsTable.userId))
              .where(eq(walletsTable.flwPsaAccountReference, row.accountReference));

            if (!walletRow) {
              logger.warn({ accountReference: row.accountReference, providerReference }, "payout funding: PSA wallet owner not found");
              continue;
            }

            const ledgerReference = `PSA-${providerReference}`.slice(0, 48);
            const flagReason = getDepositFlagReason(walletRow.user.kycLevel, amount);
            const now = new Date();

            const result = await db.transaction(async (dbtx) => {
              const [ledgerTx] = await dbtx.insert(transactionsTable).values({
                userId: walletRow.user.id,
                type: "fund",
                amount: amount.toFixed(2),
                status: flagReason ? "pending" : "success",
                reference: ledgerReference,
                description: flagReason
                  ? "Wallet funding via personal bank account — held for KYC review"
                  : "Wallet funded via personal bank account",
                isFlagged: Boolean(flagReason),
                flagReason,
                metadata: JSON.stringify({
                  provider: "flutterwave-psa-poller",
                  providerReference,
                  accountReference: row.accountReference,
                  accountNumber: tx?.account_number ?? null,
                  bankName: tx?.bank_name ?? null,
                  senderName: tx?.fullname ?? null,
                  receivedAt: now.toISOString(),
                  heldForKyc: Boolean(flagReason),
                }),
              }).onConflictDoNothing({ target: transactionsTable.reference }).returning({ id: transactionsTable.id });

              if (!ledgerTx) return { duplicate: true, held: false, txId: null };
              if (flagReason) return { duplicate: false, held: true, txId: ledgerTx.id };

              const [updatedWallet] = await dbtx.update(walletsTable)
                .set({
                  balance: sql`${walletsTable.balance} + ${amount}`,
                  ledgerBalance: sql`${walletsTable.ledgerBalance} + ${amount}`,
                })
                .where(eq(walletsTable.userId, walletRow.user.id))
                .returning({ balance: walletsTable.balance });

              if (!updatedWallet) throw new Error("CipherPay wallet could not be updated for PSA funding");

              const balanceAfter = parseFloat(updatedWallet.balance);
              const balanceBefore = balanceAfter - amount;
              await dbtx.update(transactionsTable)
                .set({ balanceBefore: balanceBefore.toFixed(2), balanceAfter: balanceAfter.toFixed(2) })
                .where(eq(transactionsTable.id, ledgerTx.id));

              return { duplicate: false, held: false, txId: ledgerTx.id };
            });

            if (result.duplicate) {
              logger.info({ providerReference, ledgerReference }, "payout funding: already reconciled");
              continue;
            }

            if (result.held) {
              await notifyUser({
                userId: walletRow.user.id,
                type: "warning",
                title: "Deposit received — KYC review required",
                body: `Your ₦${amount.toLocaleString()} deposit was received but is being held because ${flagReason!.toLowerCase()} Complete your KYC and an admin will release it.`,
                link: result.txId ? `/transactions/${result.txId}` : "/transactions",
              }).catch(() => {});
              logger.info({ txId: result.txId, userId: walletRow.user.id, amount, providerReference, flagReason }, "payout funding: deposit held");
              continue;
            }

            await notifyUser({
              userId: walletRow.user.id,
              type: "transaction",
              title: "Wallet funded ✓",
              body: `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been added to your CipherPay wallet.`,
              link: "/transactions",
            }).catch(() => {});
            logger.info({ txId: result.txId, userId: walletRow.user.id, amount, providerReference }, "payout funding: deposit credited");
          }
        } catch (e: any) {
          logger.warn({ err: e?.message, accountReference: row.accountReference }, "payout funding poll failed");
        }
      }

      // Move every successfully charged withdrawal fee from the user's PSA to
      // CipherPay's main Flutterwave/F4B wallet. This is retried automatically
      // until it succeeds, so a temporary provider/IP-whitelist failure does not
      // leave platform fees stranded inside customer PSAs.
      const successfulWithdrawals = await db.select()
        .from(transactionsTable)
        .where(sql`type = 'withdraw' AND status = 'success' AND fee IS NOT NULL AND fee > 0`);
      for (const tx of successfulWithdrawals) {
        let meta: any = {};
        try { meta = JSON.parse(tx.metadata ?? "{}"); } catch { continue; }
        const fee = Number(meta.fee ?? tx.fee ?? 0);
        const debitSubaccount = String(meta.payoutSubaccount ?? "").trim();
        if (!Number.isFinite(fee) || fee <= 0 || !debitSubaccount || meta.feeTransferId) continue;
        const reference = `CP-FEE-${tx.id}`.slice(0, 48);
        try {
          const existing = await findTransferByReference(reference);
          if (existing) {
            await db.update(transactionsTable).set({
              metadata: JSON.stringify({ ...meta, feeTransferId: existing.id ?? null, feeTransferReference: reference, feeTransferStatus: String(existing.status ?? "pending").toLowerCase() }),
            }).where(eq(transactionsTable.id, tx.id));
            logger.info({ txId: tx.id, fee, transferId: existing.id, status: existing.status }, "withdrawal fee sweep already exists; reconciled");
            continue;
          }
          const transfer = await movePayoutWalletToMerchant({ debitSubaccount, amount: fee, reference });
          if (transfer.accepted) {
            await db.update(transactionsTable).set({
              metadata: JSON.stringify({ ...meta, feeTransferId: transfer.id, feeTransferReference: reference, feeTransferStatus: "success" }),
            }).where(eq(transactionsTable.id, tx.id));
            logger.info({ txId: tx.id, fee, transferId: transfer.id }, "withdrawal fee swept to merchant wallet");
          } else {
            logger.warn({ txId: tx.id, fee, message: transfer.message }, "withdrawal fee sweep not completed; will retry");
          }
        } catch (e: any) {
          logger.warn({ txId: tx.id, fee, err: e?.message }, "withdrawal fee sweep failed; will retry");
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