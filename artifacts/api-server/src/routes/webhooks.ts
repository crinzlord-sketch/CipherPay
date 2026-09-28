import { type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, transactionsTable, walletsTable, notificationsTable } from "@workspace/db";
import { creditWallet, getOrCreateWallet } from "../lib/wallet";
import { notifyUser } from "../lib/notifications";

function verifyHash(header: string | undefined): boolean {
  const expected = process.env.FLW_SECRET_HASH;
  if (!expected || !header) return false;
  if (header.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

interface FlwEvent {
  event?: string;
  "event.type"?: string;
  data?: {
    id?: number;
    status?: string;
    tx_ref?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    complete_message?: string;
  };
}

export async function flutterwaveWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!verifyHash(req.header("verif-hash"))) {
    req.log?.warn?.("flutterwave webhook: bad/missing verif-hash");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const evt = (req.body ?? {}) as FlwEvent;
  res.status(200).json({ received: true });

  try {
    await handleEvent(req, evt);
  } catch (e: any) {
    req.log?.error?.({ err: e?.message, evt: evt.event }, "flutterwave webhook processing failed");
  }
}

async function handleEvent(req: Request, evt: FlwEvent): Promise<void> {
  const eventName = evt.event ?? evt["event.type"] ?? "";
  const data = evt.data ?? {};

  if (eventName === "charge.completed") {
    const ref = data.tx_ref;
    if (!ref) { req.log?.warn?.("flw webhook: charge.completed without tx_ref"); return; }
    if (String(data.status).toLowerCase() !== "successful") {
      req.log?.info?.({ ref, status: data.status }, "flw webhook: charge not successful, ignored");
      return;
    }

    const [tx] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.reference, ref), eq(transactionsTable.type, "fund")));
    if (!tx) { req.log?.warn?.({ ref }, "flw webhook: no matching fund tx"); return; }
    if (tx.status === "success") { return; }

    const expected = parseFloat(tx.amount);
    if (Number(data.amount ?? 0) + 0.001 < expected) {
      req.log?.warn?.({ ref, expected, got: data.amount }, "flw webhook: charge amount mismatch");
      return;
    }
    if ((data.currency ?? "NGN").toUpperCase() !== "NGN") { return; }

    await getOrCreateWallet(tx.userId);

    // Check whether this funding was routed through the user's Flutterwave
    // subaccount (split payment). If yes, the money landed in the subaccount,
    // so we must also increment flwSubaccountBalance to match.
    let txMeta: Record<string, unknown> = {};
    try { txMeta = JSON.parse(tx.metadata ?? "{}"); } catch { /* ignore */ }
    const routedToSubaccount = !!txMeta.flwSubaccountId;
    if (tx.isFlagged) {
      req.log?.info?.({ txId: tx.id, flagReason: tx.flagReason }, "flw webhook: deposit held for KYC review");
      await notifyUser({
        userId: tx.userId,
        type: "warning",
        title: "Deposit received — KYC review required",
        body: `Your ₦${expected.toLocaleString()} payment was received but is being held because ${tx.flagReason ?? "your KYC deposit limit was exceeded"}. An admin will release it after your KYC is complete.`,
        link: `/transactions/${tx.id}`,
      }).catch(() => {});
      return;
    }

    await db.transaction(async (dbtx) => {
      const updated = await dbtx.update(transactionsTable)
        .set({ status: "success" })
        .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
        .returning({ id: transactionsTable.id });
      if (updated.length === 0) return;

      const walletUpdate: Record<string, unknown> = {
        balance: sql`${walletsTable.balance} + ${expected}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} + ${expected}`,
      };
      if (routedToSubaccount) {
        walletUpdate.flwSubaccountBalance = sql`${walletsTable.flwSubaccountBalance} + ${expected}`;
      }

      const [w] = await dbtx.update(walletsTable)
        .set(walletUpdate)
        .where(eq(walletsTable.userId, tx.userId))
        .returning({ balance: walletsTable.balance });
      const after = parseFloat(w.balance);
      const before = after - expected;
      await dbtx.update(transactionsTable)
        .set({ balanceBefore: before.toFixed(2), balanceAfter: after.toFixed(2) })
        .where(eq(transactionsTable.id, tx.id));
    });
    req.log?.info?.({ txId: tx.id, routedToSubaccount }, "flw webhook: deposit credited");
    await notifyUser({
      userId: tx.userId, type: "transaction",
      title: `Wallet funded ✓`,
      body: `₦${expected.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been added to your CipherPay wallet.`,
      link: `/transactions`,
    }).catch(() => {});
    return;
  }

  if (eventName === "transfer.completed") {
    const ref = data.reference;
    const status = String(data.status ?? "").toUpperCase();
    if (!ref) { req.log?.warn?.("flw webhook: transfer.completed without reference"); return; }

    const [tx] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.reference, ref), eq(transactionsTable.type, "withdraw")));
    if (!tx) { req.log?.warn?.({ ref }, "flw webhook: no matching withdrawal tx"); return; }

    if (status === "SUCCESSFUL") {
      const updated = await db.update(transactionsTable)
        .set({ status: "success" })
        .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
        .returning({ id: transactionsTable.id });
      if (updated.length > 0) {
        const netAmount = Math.abs(parseFloat(tx.amount));
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(tx.metadata ?? "{}"); } catch { /* ignore */ }
        const accountName = String(meta.accountName ?? "");
        const accountNumber = String(meta.accountNumber ?? "");
        const recipient = accountName ? `${accountName} (${accountNumber})` : accountNumber;
        const successBody = `Your ₦${netAmount.toLocaleString()} withdrawal to ${recipient} has been sent successfully.`;
        // Update the original "Withdrawal processing" notification so it reflects
        // the final status instead of staying as "pending" forever.
        await db.update(notificationsTable)
          .set({ title: "Withdrawal sent ✓", body: successBody, type: "success" })
          .where(and(
            eq(notificationsTable.userId, tx.userId),
            eq(notificationsTable.link, `/transactions/${tx.id}`),
            eq(notificationsTable.type, "transaction"),
          ));
        // Also create a fresh success notification in case the original was already read/dismissed.
        await notifyUser({
          userId: tx.userId,
          type: "success",
          title: "Withdrawal sent",
          body: successBody,
          link: `/transactions/${tx.id}`,
        });
      }
      req.log?.info?.({ txId: tx.id, updated: updated.length }, "flw webhook: transfer success");
      return;
    }

    if (status === "FAILED") {
      const refunded = await db.update(transactionsTable)
        .set({ status: "failed", description: `${tx.description ?? "Withdrawal"} — failed (${data.complete_message ?? "provider"})` })
        .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
        .returning({ id: transactionsTable.id, amount: transactionsTable.amount, metadata: transactionsTable.metadata });
      if (refunded.length === 0) { return; }
      const refundAmount = Math.abs(Number(refunded[0].amount));
      await creditWallet(tx.userId, refundAmount, `Refund: Withdrawal failed (tx #${tx.id})`, "refund", { originalTxId: tx.id, type: "withdraw" });

      // If the withdrawal debited from the user's Flutterwave subaccount, restore
      // that balance now that the transfer has failed.
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(refunded[0].metadata ?? "{}"); } catch { /* ignore */ }
      const subaccountDebitAmount = Number(meta.subaccountDebitAmount ?? 0);
      if (meta.usedSubaccountDebit && subaccountDebitAmount > 0) {
        await db.update(walletsTable)
          .set({ flwSubaccountBalance: sql`${walletsTable.flwSubaccountBalance} + ${subaccountDebitAmount}` })
          .where(eq(walletsTable.userId, tx.userId));
        req.log?.info?.({ txId: tx.id, subaccountDebitAmount }, "flw webhook: subaccount balance restored on failed transfer");
      }

      const failedBody = `Your withdrawal of ₦${refundAmount.toLocaleString()} could not be processed and has been refunded to your wallet.`;
      // Update the original "processing" notification to show it failed.
      await db.update(notificationsTable)
        .set({ title: "Withdrawal failed", body: failedBody, type: "error" })
        .where(and(
          eq(notificationsTable.userId, tx.userId),
          eq(notificationsTable.link, `/transactions/${tx.id}`),
          eq(notificationsTable.type, "transaction"),
        ));
      await notifyUser({
        userId: tx.userId,
        type: "error",
        title: "Withdrawal failed",
        body: failedBody,
        link: `/transactions/${tx.id}`,
      });

      req.log?.info?.({ txId: tx.id, refundAmount }, "flw webhook: transfer failed, refunded");
      return;
    }

    req.log?.info?.({ ref, status }, "flw webhook: transfer event noted (no state change)");
    return;
  }

  req.log?.info?.({ event: eventName }, "flw webhook: ignored event");
}

