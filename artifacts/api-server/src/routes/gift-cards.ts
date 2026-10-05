import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, giftCardOrdersTable, savedAccountsTable, usersTable } from "@workspace/db";
import { notifyUser } from "../lib/notifications";
import { sendAdminAlertEmail } from "../lib/email";
import { creditWallet } from "../lib/wallet";
import { requireAdmin, type AdminRequest } from "../lib/admin-auth";

const router: IRouter = Router();
const SOGO_BASE = process.env.SOGO_API_BASE?.replace(/\/+$/, "") || "https://api.sogo.africa/v1";
const FEE_PERCENT = Math.max(0, Math.min(25, Number(process.env.GIFTCARD_FEE_PERCENT ?? 5)));

function userId(req: Request): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : String(raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}

function sogoHeaders(idempotencyKey?: string) {
  const key = process.env.SOGO_SECRET_KEY?.trim();
  if (!key) throw new Error("Gift card provider is not configured.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function sogoGet(path: string) {
  const response = await fetch(`${SOGO_BASE}${path}`, { headers: sogoHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `Sogo returned HTTP ${response.status}`);
  return payload;
}

async function notifyAdmins(title: string, body: string, link = "/admin?tab=gift-cards") {
  const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isAdmin, true));
  await Promise.allSettled(admins.map((admin) => notifyUser({
    userId: admin.id,
    title,
    body,
    type: "admin_gift_card",
    link,
    email: false,
  })));
  try { await sendAdminAlertEmail(title, body); } catch { /* admin alert email is best-effort */ }
}

router.get("/gift-cards/catalog", async (_req, res): Promise<void> => {
  try {
    const payload = await sogoGet("/gift-cards/sell/catalog");
    res.json(payload);
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Gift card catalogue unavailable." });
  }
});

router.get("/gift-cards/rates", async (req, res): Promise<void> => {
  try {
    const slug = String(req.query.slug ?? "").trim();
    const payload = await sogoGet(`/gift-cards/sell/rates${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`);
    res.json({ ...payload, feePercent: FEE_PERCENT });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Gift card rates unavailable." });
  }
});

router.get("/gift-cards/orders", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(giftCardOrdersTable)
    .where(eq(giftCardOrdersTable.userId, id))
    .orderBy(desc(giftCardOrdersTable.createdAt))
    .limit(50);
  res.json({ data: rows.map(formatOrder) });
});

router.post("/gift-cards/redeem", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body ?? {};
  const slug = String(body.slug ?? "").trim();
  const countryCode = String(body.countryCode ?? "").trim().toUpperCase();
  const cardType = String(body.cardType ?? "ecode").trim();
  const currencyCode = String(body.currencyCode ?? "").trim().toUpperCase();
  const cardAmount = Number(body.cardAmount);
  const code = String(body.code ?? "").trim();
  const destination = body.payoutDestination === "bank" ? "bank" : "wallet";
  const accountId = Number(body.payoutAccountId);

  if (!slug || !countryCode || !currencyCode || !Number.isFinite(cardAmount) || cardAmount <= 0 || !code) {
    res.status(400).json({ error: "Brand, country, currency, amount, and gift card code are required." });
    return;
  }
  if (cardType !== "ecode") {
    res.status(400).json({ error: "E-code redemption is enabled first. Physical-card submission will be added after provider image upload is configured." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (process.env.SOGO_ENV === "live" && Number(user.kycLevel ?? 0) < 1) {
    res.status(403).json({ error: "Gift card selling requires identity verification before you can redeem a card." });
    return;
  }

  let account: typeof savedAccountsTable.$inferSelect | undefined;
  if (destination === "bank") {
    if (!Number.isFinite(accountId)) { res.status(400).json({ error: "Select a withdrawal account." }); return; }
    [account] = await db.select().from(savedAccountsTable)
      .where(and(eq(savedAccountsTable.id, accountId), eq(savedAccountsTable.userId, id))).limit(1);
    if (!account) { res.status(400).json({ error: "That withdrawal account is not available." }); return; }
  }

  let ratePayload: any;
  try {
    ratePayload = await sogoGet(`/gift-cards/sell/rates?slug=${encodeURIComponent(slug)}`);
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Could not get the live gift card rate." });
    return;
  }

  const idempotencyKey = crypto.randomUUID();
  let provider: any;
  try {
    const response = await fetch(`${SOGO_BASE}/gift-cards/sell`, {
      method: "POST",
      headers: sogoHeaders(idempotencyKey),
      body: JSON.stringify({
        slug,
        card_country: countryCode,
        card_type: cardType,
        card_currency: currencyCode,
        card_amount: cardAmount,
        additional_info: code,
        payout_currency: "NGN",
      }),
    });
    provider = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(provider?.message ?? provider?.error ?? `Sogo returned HTTP ${response.status}`);
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Gift card submission failed." });
    return;
  }

  const providerData = provider?.data ?? {};
  const payout = Number(providerData?.payout_amount?.raw ?? 0);
  if (!Number.isFinite(payout) || payout <= 0) {
    res.status(502).json({ error: "The provider did not return a valid Naira payout." });
    return;
  }
  const fee = Number((payout * FEE_PERCENT / 100).toFixed(2));
  const net = Number((payout - fee).toFixed(2));

  const [order] = await db.insert(giftCardOrdersTable).values({
    userId: id,
    productId: 0,
    productName: String(providerData.card_name ?? slug),
    countryCode,
    currencyCode,
    unitPrice: cardAmount.toFixed(2),
    quantity: 1,
    amountPaidNgn: payout.toFixed(2),
    recipientEmail: user.email,
    status: "processing",
    redemptionCode: null,
    externalTransactionId: String(providerData.id ?? ""),
    sogoReference: String(providerData.reference ?? ""),
    sogoTransactionId: String(providerData.id ?? ""),
    payoutAmountNgn: payout.toFixed(2),
    feeNgn: fee.toFixed(2),
    netPayoutNgn: net.toFixed(2),
    payoutDestination: destination,
    payoutAccountId: destination === "bank" ? account!.id : null,
    payoutAccountName: destination === "bank" ? account!.accountName : null,
    payoutAccountNumber: destination === "bank" ? account!.accountNumber : null,
    payoutBankName: destination === "bank" ? account!.bankName : null,
  }).returning();

  await notifyUser({
    userId: id,
    title: "Gift card is processing",
    body: `Your ${String(providerData.card_name ?? slug)} was submitted successfully. We are processing it now. Payout can take up to 10 minutes after verification.`,
    type: "transaction",
    link: "/gift-cards",
  });

  await notifyAdmins(
    "Gift card redemption needs processing",
    `User #${id} submitted ${String(providerData.card_name ?? slug)} for an expected payout of ₦${net.toLocaleString("en-NG", { minimumFractionDigits: 2 })}. Reference: ${order.sogoReference || "pending"}.`,
  );

  res.status(201).json({ data: formatOrder(order), feePercent: FEE_PERCENT, rateSnapshot: ratePayload });
});

function formatOrder(row: typeof giftCardOrdersTable.$inferSelect) {
  return {
    id: row.id,
    productName: row.productName,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    cardAmount: Number(row.unitPrice),
    status: row.status,
    sogoReference: row.sogoReference,
    payoutAmount: Number(row.payoutAmountNgn ?? row.amountPaidNgn ?? 0),
    fee: Number(row.feeNgn ?? 0),
    netPayout: Number(row.netPayoutNgn ?? 0),
    payoutDestination: row.payoutDestination,
    payoutAccount: row.payoutDestination === "bank" ? {
      accountName: row.payoutAccountName,
      accountNumber: row.payoutAccountNumber,
      bankName: row.payoutBankName,
    } : null,
    failureReason: row.failureReason,
    processingStartedAt: row.processingStartedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function handleSogoGiftCardWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.SOGO_WEBHOOK_SECRET?.trim();
  const rawBody = Buffer.isBuffer((req as any).rawBody) ? (req as any).rawBody : Buffer.from(JSON.stringify(req.body ?? {}));
  const received = String(req.header("X-Sogo-Signature-256") ?? "");
  if (!secret || !received) { res.status(401).json({ error: "Invalid webhook signature" }); return; }
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(401).json({ error: "Invalid webhook signature" }); return; }

  res.status(200).json({ received: true });
  try {
    const event = req.body ?? {};
    const data = event.data ?? {};
    const reference = String(data.reference ?? "").trim();
    if (!reference) return;
    const [order] = await db.select().from(giftCardOrdersTable).where(eq(giftCardOrdersTable.sogoReference, reference)).limit(1);
    if (!order) return;

    if (event.event === "transaction.completed") {
      const payout = Number(data.payout_amount?.raw ?? data.net_amount ?? data.amount ?? order.payoutAmountNgn ?? 0);
      const fee = Number((payout * FEE_PERCENT / 100).toFixed(2));
      const net = Number((payout - fee).toFixed(2));
      await db.update(giftCardOrdersTable).set({
        status: "verified",
        payoutAmountNgn: payout.toFixed(2),
        amountPaidNgn: payout.toFixed(2),
        feeNgn: fee.toFixed(2),
        netPayoutNgn: net.toFixed(2),
        processingStartedAt: new Date(),
        sogoTransactionId: String(data.id ?? order.sogoTransactionId ?? ""),
      }).where(and(eq(giftCardOrdersTable.id, order.id), inArray(giftCardOrdersTable.status, ["processing", "pending"])));

      await notifyUser({
        userId: order.userId,
        title: "Gift card verified ✓",
        body: `Your gift card was verified successfully. ₦${net.toLocaleString("en-NG", { minimumFractionDigits: 2 })} is now being prepared for payout. This can take up to 10 minutes.`,
        type: "transaction",
        link: "/gift-cards",
      });
      await notifyAdmins(
        "Gift card verified — payout required",
        `Gift card #${order.id} (${order.sogoReference}) is verified. Pay ₦${net.toLocaleString("en-NG", { minimumFractionDigits: 2 })} to the user and mark it completed.`,
      );
    } else if (event.event === "transaction.cancelled" || event.event === "transaction.failed") {
      const reason = String(data.failure_reason ?? data.message ?? "Gift card could not be verified.");
      await db.update(giftCardOrdersTable).set({ status: "rejected", failureReason: reason })
        .where(and(eq(giftCardOrdersTable.id, order.id), inArray(giftCardOrdersTable.status, ["processing", "pending"])));
      await notifyUser({ userId: order.userId, title: "Gift card not accepted", body: reason, type: "error", link: "/gift-cards" });
    }
  } catch (e: any) {
    req.log?.error?.({ err: e?.message }, "Sogo gift card webhook processing failed");
  }
}

router.get("/admin/gift-card-orders", requireAdmin, async (_req: AdminRequest, res): Promise<void> => {
  const rows = await db.select({
    order: giftCardOrdersTable,
    userEmail: usersTable.email,
    userFirst: usersTable.firstName,
    userLast: usersTable.lastName,
  }).from(giftCardOrdersTable).innerJoin(usersTable, eq(usersTable.id, giftCardOrdersTable.userId))
    .orderBy(desc(giftCardOrdersTable.createdAt)).limit(200);
  res.json({ data: rows.map(({ order, ...user }) => ({ ...formatOrder(order), ...user, userId: order.userId })) });
});

router.post("/admin/gift-card-orders/:id/complete", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid gift card order." }); return; }
  const [order] = await db.select().from(giftCardOrdersTable).where(eq(giftCardOrdersTable.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Gift card order not found." }); return; }
  if (!["verified", "processing"].includes(order.status)) { res.status(400).json({ error: `Order is already ${order.status}.` }); return; }

  const actualNet = Number(req.body?.netPayout ?? order.netPayoutNgn ?? 0);
  if (!Number.isFinite(actualNet) || actualNet <= 0) { res.status(400).json({ error: "Enter a valid payout amount." }); return; }

  if (order.payoutDestination === "wallet") {
    await creditWallet(order.userId, actualNet, `Gift card payout — ${order.productName} (${order.sogoReference ?? "no reference"})`, "gift_card", {
      giftCardOrderId: order.id,
      sogoReference: order.sogoReference,
      fee: Number(order.feeNgn ?? 0),
    });
  }

  await db.update(giftCardOrdersTable).set({
    status: "completed",
    netPayoutNgn: actualNet.toFixed(2),
    adminId: req.admin!.id,
    completedAt: new Date(),
  }).where(and(eq(giftCardOrdersTable.id, id), inArray(giftCardOrdersTable.status, ["verified", "processing"])));

  await notifyUser({
    userId: order.userId,
    title: "Gift card payout completed ✓",
    body: order.payoutDestination === "wallet"
      ? `₦${actualNet.toLocaleString("en-NG", { minimumFractionDigits: 2 })} has been credited to your CipherPay wallet.`
      : `Your ₦${actualNet.toLocaleString("en-NG", { minimumFractionDigits: 2 })} gift card payout has been sent to your bank account.`,
    type: "success",
    link: "/gift-cards",
    email: true,
  });

  res.json({ success: true });
});

router.post("/admin/gift-card-orders/:id/reject", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "Rejected by admin").trim();
  const [order] = await db.select().from(giftCardOrdersTable).where(eq(giftCardOrdersTable.id, id)).limit(1);
  if (!order) { res.status(404).json({ error: "Gift card order not found." }); return; }
  if (order.status === "completed") { res.status(400).json({ error: "Completed orders cannot be rejected." }); return; }
  await db.update(giftCardOrdersTable).set({ status: "rejected", failureReason: reason, adminId: req.admin!.id }).where(eq(giftCardOrdersTable.id, id));
  await notifyUser({ userId: order.userId, title: "Gift card payout rejected", body: reason, type: "error", link: "/gift-cards", email: true });
  res.json({ success: true });
});

export default router;
