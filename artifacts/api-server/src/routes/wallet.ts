import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, desc, and, or, gte, lte, sql, ne, inArray } from "drizzle-orm";
import { db, walletsTable, transactionsTable, usersTable } from "@workspace/db";
import { FundWalletBody, VerifyFundingBody, WalletTransferBody, WithdrawFundsBody, ListTransactionsQueryParams, ClaimDepositBody } from "@workspace/api-zod";
import { getOrCreateWallet, creditWallet, debitWallet, formatWallet, formatTransaction } from "../lib/wallet";
import { generateReference } from "../lib/auth";
import { createTransfer, initiateBankTransfer, friendlyFlwError } from "../lib/flutterwave";

import { ensureUserPayoutWallet } from "../lib/payout-wallet";
import { notifyUser } from "../lib/notifications";
import { checkDepositLimit, checkPerTxLimitSync, getDepositFlagReason } from "../lib/kycLimits";
import { getServiceFeatureStatus, type ServiceFeatureKey } from "../lib/service-features";

const router: IRouter = Router();
router.use(async (req, res, next) => {
  let feature: ServiceFeatureKey | null = null;
  if (req.path.startsWith("/wallet/fund")) feature = "wallet_funding";
  else if (req.path.startsWith("/wallet/transfer")) feature = "transfers";
  else if (req.path.startsWith("/crypto")) feature = "crypto";
  else if (req.path.startsWith("/wallet/withdraw")) { res.status(503).json({ error: "Withdrawals are disabled." }); return; }
  if (!feature) return next();
  try {
    const status = await getServiceFeatureStatus();
    if (!status[feature]) { res.status(503).json({ error: "This service is temporarily unavailable.", code: "SERVICE_DISABLED", feature }); return; }
    next();
  } catch (e) { next(e); }
});

// Tiered withdrawal processing fee (NGN). Charged on top of the amount the
// user wants delivered. Kept here next to the route that consumes it so the
// admin approval screen can compute the same number for display.
export function withdrawalFee(amount: number): number {
  if (amount < 5000) return 50;
  if (amount < 25000) return 100;
  if (amount < 100000) return 250;
  return 500;
}

// Internal (CipherPay-to-CipherPay) transfer fee. Charged on top of the amount
// the recipient receives. Lower than withdrawal fees since funds stay on-platform.
export function internalTransferFee(amount: number): number {
  if (amount < 5000) return 10;
  if (amount < 25000) return 25;
  if (amount < 100000) return 50;
  return 100;
}


async function requireTransferPin(userId: number, pin: unknown): Promise<string | null> {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "Enter your 4-digit transfer PIN.";
  const [user] = await db.select({ pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.pinHash) return "Create your 4-digit transfer PIN before making a transfer.";
  if (!(await bcrypt.compare(pin, user.pinHash))) return "Incorrect transfer PIN.";
  return null;
}

function getUserId(req: any): number | null {
  const rawId = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  return isNaN(id) ? null : id;
}

router.get("/wallet", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wallet = await getOrCreateWallet(userId);
  res.json(formatWallet(wallet));
});

// The per-user CipherPay payout account shown for manual deposits.
router.get("/wallet/deposit-account", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const payout = await ensureUserPayoutWallet(userId);
    const personName = `${payout.user.firstName} ${payout.user.lastName}`.trim();
    const accountName = `CipherPay - ${personName}`;
    res.json({
      configured: true,
      accountNumber: payout.accountNumber,
      bankName: payout.bankName,
      accountName,
      currency: "NGN",
      permanent: true,
    });
  } catch (e: any) {
    req.log?.warn?.({ userId, err: e?.message }, "payout wallet provisioning failed");
    res.status(502).json({ error: friendlyFlwError(e?.message) });
  }
});

// User submits a pending bank-transfer deposit after sending money to our fixed
// account. An admin confirms it (no Flutterwave verification — see admin route),
// which credits the wallet. This is the manual funding path that avoids needing
// a provider virtual account (which requires egress-IP whitelisting).
router.post("/wallet/deposit/claim", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ClaimDepositBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i: { path: (string|number)[]; message: string }) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { amount } = parsed.data;
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Amount must be at least ₦100" }); return; }
  const hardLimitError = await checkDepositLimit(userId, 0, amount);
  if (hardLimitError) { res.status(400).json({ error: hardLimitError }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const flagReason = getDepositFlagReason(user?.kycLevel ?? 0, amount);

  const reference = generateReference("DEP");
  const [tx] = await db.insert(transactionsTable).values({
    userId,
    type: "fund",
    amount: amount.toFixed(2),
    status: "pending",
    reference,
    description: "Wallet funding via bank transfer",
    isFlagged: Boolean(flagReason),
    flagReason,
    metadata: JSON.stringify({ provider: "manual-bank-transfer", claimedAt: new Date().toISOString(), heldForKyc: Boolean(flagReason) }),
  }).returning();

  await notifyUser({
    userId, type: "transaction",
    title: flagReason ? "Deposit held for KYC review" : "Deposit submitted",
    body: flagReason
      ? `Your ₦${amount.toLocaleString()} deposit was flagged because ${flagReason.toLowerCase()} It will be released after your KYC is completed and an admin confirms the payment.`
      : `We received your ₦${amount.toLocaleString()} bank-transfer deposit request. It'll reflect once we confirm the payment.`,
    link: "/transactions",
  }).catch(() => {});

  res.json({
    success: true,
    message: "Deposit submitted. We'll credit your wallet once the transfer is confirmed.",
    transaction: formatTransaction(tx),
  });
});

export async function creditOpayFunding(reference: string, providerStatus?: { amount: number; currency: string; orderNo?: string }) {
  const [pendingTx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.type, "fund")));
  if (!pendingTx || pendingTx.status !== "pending") return { credited: false, transaction: pendingTx ?? null };

  const expectedAmount = parseFloat(pendingTx.amount);
  if (providerStatus) {
    if (providerStatus.currency !== "NGN" || providerStatus.amount + 0.001 < expectedAmount) {
      throw new Error("OPay amount or currency mismatch");
    }
  }
  if (pendingTx.isFlagged) return { credited: false, transaction: pendingTx, flagged: true };

  await getOrCreateWallet(pendingTx.userId);
  const credited = await db.transaction(async (tx) => {
    const updated = await tx.update(transactionsTable)
      .set({ status: "success", metadata: JSON.stringify({ provider: "opay", settledAt: new Date().toISOString() }) })
      .where(and(eq(transactionsTable.id, pendingTx.id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (!updated.length) return false;
    const [w] = await tx.update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} + ${expectedAmount}`,
        ledgerBalance: sql`${walletsTable.ledgerBalance} + ${expectedAmount}`,
      })
      .where(eq(walletsTable.userId, pendingTx.userId))
      .returning({ balance: walletsTable.balance });
    const balanceAfter = parseFloat(w.balance);
    await tx.update(transactionsTable).set({
      balanceBefore: (balanceAfter - expectedAmount).toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
    }).where(eq(transactionsTable.id, pendingTx.id));
    return true;
  });
  if (credited) {
    await notifyUser({
      userId: pendingTx.userId,
      type: "transaction",
      title: "Wallet funded ✓",
      body: `₦${expectedAmount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been added to your CipherPay wallet.`,
      link: "/transactions",
    }).catch(() => {});
  }
  return { credited, transaction: pendingTx };
}

router.post("/wallet/fund", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = FundWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { amount, email, channel } = parsed.data;
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Amount must be at least ₦100" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const payerEmail = email || user?.email;
  if (!payerEmail) { res.status(400).json({ error: "Email is required for payment" }); return; }

  const depositLimitError = await checkDepositLimit(userId, user?.kycLevel ?? 0, amount);
  if (depositLimitError) { res.status(400).json({ error: depositLimitError }); return; }
  const flagReason = getDepositFlagReason(user?.kycLevel ?? 0, amount);
  const reference = opayReference(String(userId));

  await db.insert(transactionsTable).values({
    userId,
    type: "fund",
    amount: amount.toFixed(2),
    status: "pending",
    reference,
    description: flagReason ? "Wallet funding via OPay — held for KYC review" : "Wallet funding via OPay",
    isFlagged: Boolean(flagReason),
    flagReason,
    metadata: JSON.stringify({ provider: "opay", email: payerEmail, channel, heldForKyc: Boolean(flagReason) }),
  });

  const configuredApiUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  const callbackUrl = `${configuredApiUrl}/api/webhooks/opay`;
  const returnUrl = `${configuredApiUrl}/api/opay/return`;
  try {
    if (channel === "bank_transfer") {
      const transfer = await createBankTransferPayment({
        reference, amount, callbackUrl, returnUrl,
        email: payerEmail,
        name: user ? `${user.firstName} ${user.lastName}` : undefined,
        phone: user?.phone ?? undefined,
      });
      res.json({
        reference: transfer.reference,
        account: {
          accountNumber: transfer.accountNumber,
          bankName: transfer.bankName,
          accountName: "CipherPay Wallet Funding",
          beneficiaryName: "CipherPay Wallet Funding",
          permanent: false,
          currency: "NGN",
          expiresAt: transfer.expiresAt,
          amount: transfer.amount,
          note: "Send the exact amount shown. OPay will confirm the transfer automatically.",
        },
      });
      return;
    }

    const cashier = await createCashierPayment({
      reference, amount, email: payerEmail,
      name: user ? `${user.firstName} ${user.lastName}` : undefined,
      phone: user?.phone ?? undefined, callbackUrl, returnUrl,
    });
    res.json({
      reference: cashier.reference,
      cashierUrl: cashier.cashierUrl,
      amount: cashier.amount,
      currency: "NGN",
      customer: { email: payerEmail, name: user ? `${user.firstName} ${user.lastName}` : undefined },
    });
  } catch (e: any) {
    await db.update(transactionsTable).set({ status: "failed" }).where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.status, "pending")));
    req.log?.warn?.({ err: e?.message, reference }, "OPay funding init failed");
    res.status(502).json({ error: friendlyOpayError(e?.message) });
  }
});

router.post("/wallet/fund/card", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const amount = Number(req.body?.amount);
  const cardNumber = String(req.body?.cardNumber ?? "").replace(/\s+/g, "");
  const cardHolderName = String(req.body?.cardHolderName ?? "").trim().slice(0, 80);
  const expiryMonth = String(req.body?.expiryMonth ?? "").padStart(2, "0");
  const expiryYear = String(req.body?.expiryYear ?? "");
  const cvv = String(req.body?.cvv ?? "").trim();
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Amount must be at least ₦100" }); return; }
  if (!/^\d{12,19}$/.test(cardNumber)) { res.status(400).json({ error: "Enter a valid card number" }); return; }
  if (!/^\d{2}$/.test(expiryMonth) || Number(expiryMonth) < 1 || Number(expiryMonth) > 12) { res.status(400).json({ error: "Enter a valid expiry month" }); return; }
  if (!/^\d{2,4}$/.test(expiryYear)) { res.status(400).json({ error: "Enter a valid expiry year" }); return; }
  if (!/^\d{3,4}$/.test(cvv)) { res.status(400).json({ error: "Enter a valid CVV" }); return; }
  if (!cardHolderName) { res.status(400).json({ error: "Enter the cardholder name" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.email) { res.status(400).json({ error: "Email is required for payment" }); return; }
  const limitError = await checkDepositLimit(userId, user.kycLevel ?? 0, amount);
  if (limitError) { res.status(400).json({ error: limitError }); return; }
  const flagReason = getDepositFlagReason(user.kycLevel ?? 0, amount);
  const reference = opayReference(String(userId));
  await db.insert(transactionsTable).values({ userId, type:"fund", amount:amount.toFixed(2), status:"pending", reference, description:flagReason ? "Wallet funding via card — held for KYC review" : "Wallet funding via card", isFlagged:Boolean(flagReason), flagReason, metadata:JSON.stringify({provider:"opay",channel:"card",heldForKyc:Boolean(flagReason)}) });
  const configuredApiUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  try {
    const payment = await createCardPayment({ reference, amount, cardNumber, cardHolderName, expiryMonth, expiryYear, cvv, callbackUrl:`${configuredApiUrl}/api/webhooks/opay`, returnUrl:`${configuredApiUrl}/api/opay/return`, email:user.email, name:`${user.firstName} ${user.lastName}`, phone:user.phone ?? undefined });
    res.json({ reference:payment.reference, orderNo:payment.orderNo, status:payment.status, amount:payment.amount, currency:"NGN", redirectUrl:payment.redirectUrl, cashierUrl:payment.cashierUrl });
  } catch (e:any) {
    await db.update(transactionsTable).set({status:"failed"}).where(and(eq(transactionsTable.reference,reference),eq(transactionsTable.status,"pending")));
    req.log?.warn?.({err:e?.message,reference},"OPay card funding init failed");
    res.status(502).json({error:friendlyOpayError(e?.message)});
  }
});

router.post("/wallet/fund/bank-transfer", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Amount must be at least ₦100" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const email = user?.email;
  if (!email) { res.status(400).json({ error: "Email is required for payment" }); return; }
  const limitError = await checkDepositLimit(userId, user?.kycLevel ?? 0, amount);
  if (limitError) { res.status(400).json({ error: limitError }); return; }
  const reference = opayReference(String(userId));
  const flagReason = getDepositFlagReason(user?.kycLevel ?? 0, amount);
  await db.insert(transactionsTable).values({
    userId, type: "fund", amount: amount.toFixed(2), status: "pending", reference,
    description: flagReason ? "Wallet funding via OPay bank transfer — held for KYC review" : "Wallet funding via OPay bank transfer",
    isFlagged: Boolean(flagReason), flagReason,
    metadata: JSON.stringify({ provider: "opay", channel: "bank_transfer", email, heldForKyc: Boolean(flagReason) }),
  });
  const configuredApiUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  try {
    const transfer = await createBankTransferPayment({
      reference, amount, callbackUrl: `${configuredApiUrl}/api/webhooks/opay`,
      returnUrl: `${configuredApiUrl}/api/opay/return`, email,
      name: `${user.firstName} ${user.lastName}`, phone: user.phone ?? undefined,
    });
    res.json({ reference: transfer.reference, account: {
      accountNumber: transfer.accountNumber, bankName: transfer.bankName,
      accountName: "CipherPay Wallet Funding", beneficiaryName: "CipherPay Wallet Funding",
      permanent: false, currency: "NGN", expiresAt: transfer.expiresAt, amount: transfer.amount,
      note: "Send the exact amount shown. OPay will confirm the transfer automatically.",
    }});
  } catch (e: any) {
    await db.update(transactionsTable).set({ status: "failed" }).where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.status, "pending")));
    req.log?.warn?.({ err: e?.message, reference }, "OPay bank transfer init failed");
    res.status(502).json({ error: friendlyOpayError(e?.message) });
  }
});

router.post("/wallet/fund/verify", async (req, res): Promise<void> => {
  const parsed = VerifyFundingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }
  const { reference } = parsed.data;
  const authedUserId = getUserId(req);
  const [pendingTx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.type, "fund")));
  if (!pendingTx) { res.status(404).json({ error: "Transaction not found" }); return; }
  const respond = async (status: "success" | "failed" | "pending") => {
    if (authedUserId && authedUserId === pendingTx.userId) {
      const wallet = await getOrCreateWallet(pendingTx.userId);
      res.json({ status, reference, ...formatWallet(wallet) });
    } else res.json({ status, reference });
  };
  if (pendingTx.status === "success") { await respond("success"); return; }
  if (pendingTx.status === "failed") { await respond("failed"); return; }

  try {
    const provider = await queryPaymentStatus(reference);
    if (provider.status === "SUCCESS") {
      await creditOpayFunding(reference, provider);
      await respond("success");
      return;
    }
    if (["FAIL", "CLOSE"].includes(provider.status)) {
      await db.update(transactionsTable).set({ status: "failed" }).where(and(eq(transactionsTable.id, pendingTx.id), eq(transactionsTable.status, "pending")));
      await respond("failed");
      return;
    }
    res.status(202).json({ status: "pending", reference, error: "Payment not yet confirmed — we'll credit your wallet once it settles." });
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message, reference }, "OPay funding verification failed");
    res.status(502).json({ error: friendlyOpayError(e?.message) });
  }
});

// CipherPay-to-CipherPay transfers are enabled. Withdrawals remain disabled.
router.post("/wallet/withdraw", (_req, res) => { res.status(403).json({ error: "Withdrawals are currently disabled." }); });
router.post("/wallet/withdraw/refresh/:id", (_req, res) => { res.status(403).json({ error: "Withdrawals are currently disabled." }); });

router.post("/wallet/transfer", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = WalletTransferBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { recipientEmail, amount, note } = parsed.data;
  const pinError = await requireTransferPin(userId, req.body?.pin);
  if (pinError) { res.status(401).json({ error: pinError, code: "TRANSFER_PIN_REQUIRED" }); return; }
  const [recipient] = await db.select().from(usersTable).where(eq(usersTable.email, recipientEmail.toLowerCase()));
  if (!recipient) { res.status(404).json({ error: "Recipient not found" }); return; }
  if (recipient.id === userId) { res.status(400).json({ error: "Cannot transfer to yourself" }); return; }

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  try {
    const fee = internalTransferFee(amount);
    const { tx } = await debitWallet(userId, amount + fee, `Transfer to ${recipient.firstName} ${recipient.lastName}${note ? ` - ${note}` : ""}`, "transfer_out", { recipientId: recipient.id, fee, note });
    await db.update(transactionsTable).set({ fee: fee.toFixed(2) }).where(eq(transactionsTable.id, tx.id));
    await creditWallet(recipient.id, amount, `Transfer from ${sender?.firstName} ${sender?.lastName}`, "transfer_in", { senderId: userId });
    res.json({ success: true, message: "Transfer successful", transaction: formatTransaction(tx) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// P2P transfer by CipherPay account number. Instant, no admin approval, but a
// small fee is charged to the sender on top of the amount the recipient gets.
router.post("/wallet/transfer/p2p", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const accountNumber = String(req.body?.accountNumber ?? "").trim();
  const amount = Number(req.body?.amount);
  const note = req.body?.note ? String(req.body.note).slice(0, 140) : "";
  const pinError = await requireTransferPin(userId, req.body?.pin);
  if (pinError) { res.status(401).json({ error: pinError, code: "TRANSFER_PIN_REQUIRED" }); return; }

  if (!/^\d{10}$/.test(accountNumber)) { res.status(400).json({ error: "Enter a valid 10-digit account number" }); return; }
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Minimum transfer is ₦100" }); return; }

  const [recipient] = await db.select().from(usersTable).where(eq(usersTable.accountNumber, accountNumber));
  if (!recipient) { res.status(404).json({ error: "No CipherPay account found with that number" }); return; }
  if (recipient.id === userId) { res.status(400).json({ error: "You can't transfer to yourself" }); return; }

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  const transferLimitError = checkPerTxLimitSync(sender?.kycLevel ?? 0, amount);
  if (transferLimitError) { res.status(400).json({ error: transferLimitError }); return; }
  const fee = internalTransferFee(amount);

  try {
    const { tx } = await debitWallet(
      userId,
      amount + fee,
      `Transfer to ${recipient.firstName} ${recipient.lastName} (${accountNumber})${note ? ` - ${note}` : ""}`,
      "transfer_out",
      { recipientId: recipient.id, recipientAccount: accountNumber, fee, note },
    );
    await db.update(transactionsTable).set({ fee: fee.toFixed(2) }).where(eq(transactionsTable.id, tx.id));
    await creditWallet(
      recipient.id,
      amount,
      `Transfer from ${sender?.firstName} ${sender?.lastName}`,
      "transfer_in",
      { senderId: userId, senderAccount: sender?.accountNumber ?? null, note },
    );

    await notifyUser({ userId: recipient.id, type: "transaction", title: `You received ₦${amount.toLocaleString()}`, body: `${sender?.firstName} ${sender?.lastName} sent you ₦${amount.toLocaleString()} on CipherPay.${note ? ` Note: ${note}` : ""}` }).catch(() => {});
    await notifyUser({ userId, type: "transaction", title: "Transfer successful", body: `You sent ₦${amount.toLocaleString()} to ${recipient.firstName} ${recipient.lastName}. Fee: ₦${fee}.` }).catch(() => {});

    const wallet = await getOrCreateWallet(userId);
    res.json({
      success: true,
      message: "Transfer successful",
      fee,
      recipient: { firstName: recipient.firstName, lastName: recipient.lastName, accountNumber },
      transaction: { ...formatTransaction(tx), fee },
      wallet: formatWallet(wallet),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/wallet/withdraw", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = WithdrawFundsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.isSuspended) { res.status(403).json({ error: "Account is suspended. Contact support." }); return; }

  const { amount, bankCode, accountNumber, accountName, narration } = parsed.data;
  const bankName = String(req.body?.bankName ?? "").trim();
  const pinError = await requireTransferPin(userId, req.body?.pin);
  if (pinError) { res.status(401).json({ error: pinError, code: "TRANSFER_PIN_REQUIRED" }); return; }
  const fee = withdrawalFee(amount);

  const withdrawLimitError = checkPerTxLimitSync(user.kycLevel, amount);
  if (withdrawLimitError) { res.status(400).json({ error: withdrawLimitError }); return; }

  // Debit the wallet up-front (amount + fee) so the user can't double-spend
  // while the payout is in flight. The transaction starts "success" from
  // debitWallet; we immediately force it to "pending" until Flutterwave
  // confirms the transfer (via webhook) or it fails (refund below).
  let tx;
  try {
    ({ tx } = await debitWallet(userId, amount + fee, `Withdrawal to ${accountName} (${accountNumber})${narration ? ` - ${narration}` : ""}`, "withdraw", {
      bankCode, bankName, accountNumber, accountName, fee, requestedAt: new Date().toISOString(),
    }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  await db.update(transactionsTable).set({ status: "pending", fee: fee.toFixed(2) }).where(eq(transactionsTable.id, tx.id));

  // Fire the automatic payout. The transfer reference is the tx reference so
  // the webhook (transfer.completed) can match and finalize this row.
  // Withdraw strictly from the user's Flutterwave payout subaccount. We never
  // fall back to the primary merchant wallet, because doing so would make the
  // merchant account the source of the bank transfer.
  const senderName = user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.firstName ?? "CipherPay User";
  const narrationText = narration
    ? `${narration} (${senderName} via CipherPay)`
    : `CipherPay - ${senderName}`;

  let payout;
  try {
    payout = await ensureUserPayoutWallet(userId);
  } catch (e: any) {
    await db.update(transactionsTable).set({ status: "failed", description: `${tx.description} — payout wallet unavailable` })
      .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")));
    await creditWallet(userId, amount + fee, `Refund: Withdrawal setup failed (tx #${tx.id})`, "refund", { originalTxId: tx.id, type: "withdraw" });
    res.status(502).json({ error: "Your personal payout wallet is not ready yet. Please try again shortly." });
    return;
  }

  // Debit the user's own Flutterwave payout wallet. This does not require a
  // pre-funded merchant balance, and the payout wallet is named after the user.
  let transfer;
  try {
    transfer = await createTransfer({
      amount,
      bankCode,
      accountNumber,
      reference: tx.reference,
      narration: narrationText,
      debitSubaccount: payout.accountReference,
    });
  } catch (e: any) {
    transfer = { accepted: false, id: null, status: null, message: e?.message ?? "Transfer failed", raw: null };
  }

  if (!transfer.accepted) {
    // Provider rejected the transfer outright — mark failed and refund the full
    // debited amount (amount + fee). CAS-guarded so we never double-refund.
    const failed = await db.update(transactionsTable)
      .set({ status: "failed", description: `${tx.description} — failed (${transfer.message})` })
      .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (failed.length > 0) {
      await creditWallet(userId, amount + fee, `Refund: Withdrawal failed (tx #${tx.id})`, "refund", { originalTxId: tx.id, type: "withdraw", fee });
    }
    req.log?.warn?.({ txId: tx.id, err: transfer.message }, "withdrawal transfer rejected");
    res.status(502).json({ error: friendlyFlwError(transfer.message) });
    return;
  }

  // Accepted — persist the provider transfer id alongside the bank details so
  // the webhook / reconcile can look this up later. Include usedSubaccountDebit
  // so the webhook knows whether to restore flwSubaccountBalance on failure.
  await db.update(transactionsTable).set({
    metadata: JSON.stringify({
      bankCode, bankName, accountNumber, accountName, fee,
      reference: tx.reference, flwTransferId: transfer.id, payoutMethod: "flutterwave",
      requestedAt: new Date().toISOString(),
      payoutSource: "flutterwave_psa",
      payoutSubaccount: payout.accountReference,
    }),
  }).where(eq(transactionsTable.id, tx.id));

  await notifyUser({
    userId, type: "transaction",
    title: "Withdrawal processing",
    body: `Your ₦${amount.toLocaleString()} withdrawal to ${accountName} (${accountNumber}) is being processed. Fee: ₦${fee}.`,
    link: "/transactions",
  });

  res.json({
    success: true,
    message: "Withdrawal is processing. Funds typically arrive within minutes.",
    transaction: { ...formatTransaction(tx), status: "pending", fee },
    transferStatus: transfer.status ?? "pending",
  });
});

// User-facing endpoint: check Flutterwave for the live status of a pending
// withdrawal and update the transaction in the DB if it has settled.
router.post("/wallet/withdraw/refresh/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid transaction id" }); return; }

  const [tx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.userId, userId)));

  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (tx.type !== "withdraw") { res.status(400).json({ error: "Not a withdrawal" }); return; }
  if (tx.status !== "pending") {
    res.json({ updated: false, status: tx.status });
    return;
  }

  let meta: any = {};
  try { meta = tx.metadata ? JSON.parse(tx.metadata as string) : {}; } catch { /* */ }

  const flwTransferId = meta.flwTransferId;
  if (!flwTransferId) {
    res.status(400).json({ error: "No provider reference found — contact support." });
    return;
  }

  const { verifyTransferById } = await import("../lib/flutterwave.js");
  let result: { status: string | null; raw: any };
  try {
    result = await verifyTransferById(flwTransferId);
  } catch (e: any) {
    req.log.warn({ txId: id, err: e?.message }, "withdraw refresh: flw lookup failed");
    res.status(502).json({ error: "Could not reach payment provider. Please try again shortly." });
    return;
  }

  const flwStatus = String(result.status ?? "").toUpperCase();

  if (flwStatus === "SUCCESSFUL") {
    const rows = await db.update(transactionsTable).set({ status: "success" })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (rows.length > 0) {
      const netAmount = Math.abs(parseFloat(tx.amount));
      const acctName = String(meta.accountName ?? "");
      const acctNum = String(meta.accountNumber ?? "");
      const recipient = acctName ? `${acctName} (${acctNum})` : acctNum;
      await notifyUser({
        userId, type: "success", title: "Withdrawal sent",
        body: `Your ₦${netAmount.toLocaleString()} withdrawal to ${recipient} has been sent successfully.`,
        link: "/transactions",
      });
    }
    res.json({ updated: rows.length > 0, status: "success" });
  } else if (flwStatus === "FAILED") {
    const rows = await db.update(transactionsTable)
      .set({ status: "failed", description: `${tx.description ?? "Withdrawal"} — failed` })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (rows.length > 0) {
      await creditWallet(userId, Math.abs(parseFloat(tx.amount)), `Refund: Withdrawal failed (tx #${id})`, "refund", { originalTxId: id });
      await notifyUser({
        userId, type: "error", title: "Withdrawal failed — refunded",
        body: `Your ₦${Math.abs(parseFloat(tx.amount)).toLocaleString()} withdrawal failed. The amount has been refunded to your wallet.`,
        link: "/transactions",
      });
    }
    res.json({ updated: rows.length > 0, status: "failed" });
  } else {
    // Still in progress (NEW, PENDING, PROCESSING)
    res.json({ updated: false, status: "pending", providerStatus: flwStatus });
  }
});

router.get("/wallet/stats", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const transactions = await db.select().from(transactionsTable)
    .where(and(
      eq(transactionsTable.userId, userId),
      or(eq(transactionsTable.status, "success"), eq(transactionsTable.status, "pending")),
    ));

  let totalFunded = 0, totalSpent = 0, totalWithdrawn = 0, totalTransfers = 0;
  const categoryMap: Record<string, { amount: number; count: number }> = {};
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(dayStart);
  const dayOfWeek = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const isSpend = (tx: any) => !["fund", "withdraw", "transfer_in", "refund", "admin_credit"].includes(String(tx.type));
  const spendAmount = (tx: any) => isSpend(tx) ? Math.max(0, parseFloat(tx.amount) || 0) : 0;

  let todaySpend = 0, weeklySpend = 0, monthlySpend = 0, yearlySpend = 0;

  for (const tx of transactions) {
    const amt = Math.max(0, parseFloat(tx.amount) || 0);
    if (tx.type === "fund") totalFunded += amt;
    else if (tx.type === "withdraw" && tx.status !== "failed") totalWithdrawn += amt;
    else if (tx.type === "transfer_out") totalTransfers += amt;

    const spent = spendAmount(tx);
    if (spent > 0) {
      totalSpent += spent;
      if (!categoryMap[tx.type]) categoryMap[tx.type] = { amount: 0, count: 0 };
      categoryMap[tx.type].amount += spent;
      categoryMap[tx.type].count++;
      if (tx.createdAt >= dayStart) todaySpend += spent;
      if (tx.createdAt >= weekStart) weeklySpend += spent;
      if (tx.createdAt >= monthStart) monthlySpend += spent;
      if (tx.createdAt >= yearStart) yearlySpend += spent;
    }
  }

  const categoryBreakdown = Object.entries(categoryMap)
    .map(([category, data]) => ({ category, amount: data.amount, count: data.count }))
    .sort((a, b) => b.amount - a.amount);

  const daily: { label: string; date: string; spent: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(dayStart);
    d.setDate(dayStart.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    daily.push({
      label: d.toLocaleString("en", { weekday: "short" }),
      date: d.toISOString().slice(0, 10),
      spent: transactions.reduce((sum, tx) => sum + (tx.createdAt >= d && tx.createdAt < next ? spendAmount(tx) : 0), 0),
    });
  }

  const weekly: { label: string; start: string; spent: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() - i * 7);
    const next = new Date(d);
    next.setDate(d.getDate() + 7);
    weekly.push({
      label: i === 0 ? "This week" : d.toLocaleString("en", { month: "short", day: "numeric" }),
      start: d.toISOString().slice(0, 10),
      spent: transactions.reduce((sum, tx) => sum + (tx.createdAt >= d && tx.createdAt < next ? spendAmount(tx) : 0), 0),
    });
  }

  const monthly: { month: string; year: number; spent: number; received: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    let mSpent = 0, mReceived = 0;
    for (const tx of transactions) {
      if (tx.createdAt >= d && tx.createdAt < next) {
        const amt = Math.max(0, parseFloat(tx.amount) || 0);
        if (tx.type === "fund" || tx.type === "transfer_in" || tx.type === "admin_credit") mReceived += amt;
        else mSpent += spendAmount(tx);
      }
    }
    monthly.push({ month: d.toLocaleString("en", { month: "short" }), year: d.getFullYear(), spent: mSpent, received: mReceived });
  }

  res.json({
    totalFunded, totalSpent, totalWithdrawn, totalTransfers,
    todaySpend, weeklySpend, monthlySpend, yearlySpend,
    categoryBreakdown, daily, weekly, monthly,
  });
});

router.get("/transactions", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListTransactionsQueryParams.safeParse(req.query);
  const page = params.success ? (params.data.page ?? 1) : 1;
  const limit = params.success ? (params.data.limit ?? 20) : 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(transactionsTable.userId, userId), eq(transactionsTable.status, "success")];
  // Support comma-separated types e.g. "fund,transfer_in" for merged filter chips
  const rawType = params.success ? (params.data.type ?? "") : "";
  if (rawType) {
    const types = rawType.split(",").map((t) => t.trim()).filter(Boolean);
    if (types.length === 1) {
      conditions.push(eq(transactionsTable.type, types[0]));
    } else if (types.length > 1) {
      conditions.push(inArray(transactionsTable.type, types));
    }
  }
  // User history exposes only successful/settled entries. Pending and failed attempts remain
  // stored for reconciliation and support but are never shown in user activity/history.

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(transactionsTable).where(and(...conditions));

  const data = await db.select().from(transactionsTable)
    .where(and(...conditions))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit).offset(offset);

  res.json({ data: data.map(formatTransaction), total: Number(total), page, limit });
});

router.get("/transactions/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.userId, userId)));
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  res.json(formatTransaction(tx));
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const wallet = await getOrCreateWallet(userId);
  const recentTxs = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.status, "success")))
    .orderBy(desc(transactionsTable.createdAt)).limit(2);

  const allTxs = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.status, "success")));

  let totalFunded = 0, totalSpent = 0, totalWithdrawn = 0, totalTransfers = 0, monthlySpend = 0;
  const categoryMap: Record<string, { amount: number; count: number }> = {};
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const tx of allTxs) {
    const amt = parseFloat(tx.amount);
    if (tx.type === "fund") totalFunded += amt;
    else if (tx.type === "withdraw") totalWithdrawn += amt;
    else if (tx.type === "transfer_out") totalTransfers += amt;
    else {
      totalSpent += amt;
      if (!categoryMap[tx.type]) categoryMap[tx.type] = { amount: 0, count: 0 };
      categoryMap[tx.type].amount += amt;
      categoryMap[tx.type].count++;
      if (tx.createdAt >= monthStart) monthlySpend += amt;
    }
  }

  res.json({
    wallet: formatWallet(wallet),
    recentTransactions: recentTxs.map(formatTransaction),
    quickStats: {
      totalFunded, totalSpent, totalWithdrawn, totalTransfers, monthlySpend,
      categoryBreakdown: Object.entries(categoryMap).map(([category, data]) => ({ category, amount: data.amount, count: data.count })),
    },
  });
});

export default router;
