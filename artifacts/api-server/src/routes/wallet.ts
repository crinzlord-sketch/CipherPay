import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, desc, and, or, gte, lte, sql, ne, inArray } from "drizzle-orm";
import { db, walletsTable, transactionsTable, usersTable } from "@workspace/db";
import { FundWalletBody, VerifyFundingBody, WalletTransferBody, WithdrawFundsBody, ListTransactionsQueryParams, ClaimDepositBody } from "@workspace/api-zod";
import { getOrCreateWallet, creditWallet, debitWallet, formatWallet, formatTransaction } from "../lib/wallet";
import { generateReference } from "../lib/auth";
import { initiatePayment, verifyByReference, createTransfer, initiateBankTransfer, friendlyFlwError } from "../lib/flutterwave";
import { ensureUserPayoutWallet } from "../lib/payout-wallet";
import { notifyUser } from "../lib/notifications";
import { checkDepositLimit, checkPerTxLimitSync, getDepositFlagReason } from "../lib/kycLimits";

const router: IRouter = Router();
router.get("/crypto/markets", async (_req, res): Promise<void> => {
  const ids = "bitcoin,ethereum,solana,tether,usd-coin,binancecoin,ripple,dogecoin,cardano,avalanche-2,tron,stellar";
  const cacheKey = "__cipherPayCryptoMarkets";
  const now = Date.now();
  const cached = (globalThis as any)[cacheKey] as { at: number; data: unknown } | undefined;

  // One request returns both USD and NGN values. This is deliberately cached so
  // every CipherPay user does not create a separate provider request.
  if (cached && now - cached.at < 60_000) {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ data: cached.data, updatedAt: new Date(cached.at).toISOString(), stale: false });
    return;
  }

  try {
    const params = new URLSearchParams({
      ids,
      vs_currencies: "usd,ngn",
      include_market_cap: "true",
      include_24hr_vol: "true",
      include_24hr_change: "true",
      include_last_updated_at: "true",
    });
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}`);
    }

    const rows = await response.json() as Record<string, any>;
    const names: Record<string, { symbol: string; name: string }> = {
      bitcoin: { symbol: "BTC", name: "Bitcoin" },
      ethereum: { symbol: "ETH", name: "Ethereum" },
      solana: { symbol: "SOL", name: "Solana" },
      tether: { symbol: "USDT", name: "Tether" },
      "usd-coin": { symbol: "USDC", name: "USD Coin" },
      binancecoin: { symbol: "BNB", name: "BNB" },
      ripple: { symbol: "XRP", name: "XRP" },
      dogecoin: { symbol: "DOGE", name: "Dogecoin" },
      cardano: { symbol: "ADA", name: "Cardano" },
      "avalanche-2": { symbol: "AVAX", name: "Avalanche" },
      tron: { symbol: "TRX", name: "TRON" },
      stellar: { symbol: "XLM", name: "Stellar" },
    };

    const data = ids.split(",").map((id) => {
      const row = rows[id] ?? {};
      const meta = names[id];
      return {
        id,
        symbol: meta.symbol,
        name: meta.name,
        image: `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/${meta.symbol.toLowerCase()}.svg`,
        priceNgn: Number(row.ngn ?? 0),
        priceUsd: Number(row.usd ?? 0),
        change24h: Number(row.usd_24h_change ?? 0),
        marketCapNgn: Number(row.ngn_market_cap ?? 0),
        marketCapUsd: Number(row.usd_market_cap ?? 0),
        volumeNgn: Number(row.ngn_24h_vol ?? 0),
        volumeUsd: Number(row.usd_24h_vol ?? 0),
      };
    }).filter((item) => item.priceUsd > 0);

    if (!data.length) throw new Error("CoinGecko returned no usable market rows");

    (globalThis as any)[cacheKey] = { at: now, data };
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ data, updatedAt: new Date(now).toISOString(), stale: false });
  } catch (error: any) {
    // Keep the last good prices visible during a provider timeout/rate-limit.
    // The UI should not suddenly become an empty crypto page because a market
    // provider had a temporary network problem.
    console.warn("[crypto/markets] provider request failed:", error?.message);
    if (cached?.data) {
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: cached.data, updatedAt: new Date(cached.at).toISOString(), stale: true });
      return;
    }
    res.status(502).json({ error: "Live market provider unavailable." });
  }
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
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return "Enter your 6-digit transfer PIN.";
  const [user] = await db.select({ pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.pinHash) return "Set your 6-digit transfer PIN in Security settings before making a transfer.";
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

router.post("/wallet/fund", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = FundWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { amount, email, channel } = parsed.data;
  if (!Number.isFinite(amount) || amount < 100) { res.status(400).json({ error: "Amount must be at least ₦100" }); return; }
  // Bank-transfer funding is handled in-app via our fixed account. This hosted
  // checkout path now supports card only.
  if (channel !== "card") {
    res.status(400).json({ error: "Choose debit card or use the bank transfer funding option." });
    return;
  }
  const paymentOptions = "card";
  const reference = generateReference("FUND");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const payerEmail = email || user?.email;
  if (!payerEmail) { res.status(400).json({ error: "Email is required for payment" }); return; }

  const depositLimitError = await checkDepositLimit(userId, user?.kycLevel ?? 0, amount);
  if (depositLimitError) { res.status(400).json({ error: depositLimitError }); return; }
  const flagReason = getDepositFlagReason(user?.kycLevel ?? 0, amount);

  // Prefer the configured public API URL for external deployments. The
  // Replit-injected domain remains a development fallback.
  const configuredApiUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, "");
  const replitDomain =
    process.env.REPLIT_DEV_DOMAIN ??
    (process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(",")[0] : undefined);
  const host = replitDomain ?? (req.headers["x-forwarded-host"] as string) ?? req.get("host") ?? "localhost";
  const proto = replitDomain ? "https" : ((req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https");
  const redirectUrl = configuredApiUrl
    ? `${configuredApiUrl}/api/checkout/callback`
    : `${proto}://${host}/api/checkout/callback`;

  try {
    const init = await initiatePayment({
      amount,
      email: payerEmail,
      reference,
      redirectUrl,
      name: user ? `${user.firstName} ${user.lastName}` : undefined,
      meta: { userId },
      paymentOptions,
    });

    await db.insert(transactionsTable).values({
      userId,
      type: "fund",
      amount: amount.toFixed(2),
      status: "pending",
      reference,
      description: flagReason ? "Wallet funding via card — held for KYC review" : "Wallet funding via card",
      isFlagged: Boolean(flagReason),
      flagReason,
      metadata: JSON.stringify({ provider: "flutterwave", email: payerEmail, channel: "card", heldForKyc: Boolean(flagReason) }),
    });
    if (flagReason) {
      await notifyUser({
        userId, type: "warning", title: "Deposit held for KYC review",
        body: `Your ₦${amount.toLocaleString()} payment will remain held because ${flagReason.toLowerCase()} Complete your KYC and an admin will review and release it.`,
        link: `/transactions`,
      }).catch(() => {});
    }

    // authorizationUrl carries the Flutterwave hosted checkout link the client
    // opens in a WebView. accessCode is unused by Flutterwave but kept on the
    // response shape for backwards compatibility (we echo the reference).
    res.json({ reference, authorizationUrl: init.link, accessCode: reference });
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, "card/checkout fund init failed");
    res.status(502).json({ error: friendlyFlwError(e?.message) });
  }
});

// Bank-transfer funding: generate a temporary deposit account the user pays into
// from their own bank app. The wallet is credited by the charge.completed
// webhook (and the verify endpoint, which the client polls). Same pending fund
// transaction model as hosted checkout — keyed by `reference`.
router.post("/wallet/fund/bank-transfer", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const payout = await ensureUserPayoutWallet(userId);
    const personName = `${payout.user.firstName} ${payout.user.lastName}`.trim();
    const accountName = `CipherPay - ${personName}`;
    res.json({
      reference: null,
      account: {
        accountNumber: payout.accountNumber,
        bankName: payout.bankName,
        accountName,
        beneficiaryName: accountName,
        permanent: true,
        currency: "NGN",
      },
    });
  } catch (e: any) {
    req.log?.warn?.({ userId, err: e?.message }, "payout wallet funding account failed");
    res.status(502).json({ error: friendlyFlwError(e?.message) });
  }
});

router.post("/wallet/fund/verify", async (req, res): Promise<void> => {
  const parsed = VerifyFundingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { reference } = parsed.data;
  const authedUserId = getUserId(req);

  // Look up by reference AND type='fund' — the reference is unguessable and acts
  // as the auth token for the unauthenticated Flutterwave callback path. The type
  // guard prevents this endpoint from ever mutating a non-fund row (e.g. a pending
  // withdrawal), which would otherwise be marked failed here without a refund.
  // Authenticated callers get their full wallet back; unauthenticated callers get
  // only {status, reference}.
  const [pendingTx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.type, "fund")));
  if (!pendingTx) { res.status(404).json({ error: "Transaction not found" }); return; }

  const txUserId = pendingTx.userId;
  const respond = async (status: "success" | "failed") => {
    if (authedUserId && authedUserId === txUserId) {
      const wallet = await getOrCreateWallet(txUserId);
      res.json({ status, reference, ...formatWallet(wallet) });
    } else {
      res.json({ status, reference });
    }
  };

  if (pendingTx.status === "success") { await respond("success"); return; }
  if (pendingTx.status === "failed")  { await respond("failed");  return; }

  // Verify with Flutterwave
  let flwTx;
  try {
    flwTx = await verifyByReference(reference);
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message, reference }, "wallet fund verify failed");
    res.status(502).json({ error: friendlyFlwError(e?.message) });
    return;
  }
  if (flwTx.status !== "successful") {
    // Only mark failed on a TERMINAL provider failure. For a non-final status
    // (e.g. still "pending" at Flutterwave when the user returns early), leave the
    // row pending so the later charge.completed webhook can finalize and credit
    // it — marking it failed here would permanently block that webhook credit.
    const terminalFailure = ["failed", "cancelled", "error"].includes(String(flwTx.status).toLowerCase());
    if (terminalFailure) {
      await db.update(transactionsTable).set({ status: "failed" })
        .where(and(eq(transactionsTable.id, pendingTx.id), eq(transactionsTable.status, "pending")));
      res.status(400).json({ error: `Payment failed (status: ${flwTx.status})` });
      return;
    }
    // Non-final: keep pending, tell the client to wait for confirmation.
    res.status(202).json({ status: "pending", reference, error: "Payment not yet confirmed — we'll credit your wallet once it settles." });
    return;
  }

  // Integrity checks — must match our stored expectation before crediting.
  // Flutterwave reports the charged amount directly in naira (not kobo).
  const expectedAmount = parseFloat(pendingTx.amount);
  if (flwTx.amount + 0.001 < expectedAmount) {
    res.status(400).json({ error: "Amount mismatch — payment rejected" });
    return;
  }
  if (flwTx.currency !== "NGN") {
    res.status(400).json({ error: "Currency mismatch — payment rejected" });
    return;
  }

  if (pendingTx.isFlagged) {
    res.status(202).json({
      status: "pending",
      reference,
      flagged: true,
      message: "Payment received and held for KYC review. An admin will release it after your verification is complete.",
    });
    return;
  }

  // Ensure the wallet row exists before the atomic increment below.
  await getOrCreateWallet(txUserId);

  // Atomic credit: only the request that flips pending->success may credit. The
  // balance is incremented with a single SQL expression (no read-modify-write of
  // an absolute value), so concurrent credits cannot lose updates.
  try {
    const credited = await db.transaction(async (tx) => {
      const updated = await tx.update(transactionsTable)
        .set({ status: "success" })
        .where(and(eq(transactionsTable.id, pendingTx.id), eq(transactionsTable.status, "pending")))
        .returning({ id: transactionsTable.id });
      if (updated.length === 0) return false; // another request won the race

      const [w] = await tx.update(walletsTable)
        .set({
          balance: sql`${walletsTable.balance} + ${expectedAmount}`,
          ledgerBalance: sql`${walletsTable.ledgerBalance} + ${expectedAmount}`,
        })
        .where(eq(walletsTable.userId, txUserId))
        .returning({ balance: walletsTable.balance });
      const balanceAfter = parseFloat(w.balance);
      const balanceBefore = balanceAfter - expectedAmount;
      await tx.update(transactionsTable).set({
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
      }).where(eq(transactionsTable.id, pendingTx.id));
      return true;
    });
    if (credited) {
      await notifyUser({
        userId: txUserId, type: "transaction",
        title: "Wallet funded ✓",
        body: `₦${expectedAmount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been added to your CipherPay wallet.`,
        link: `/transactions`,
      }).catch(() => {});
    }
    await respond("success");
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Crediting failed" });
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

  const conditions = [eq(transactionsTable.userId, userId)];
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
  if (params.success && params.data.status) {
    conditions.push(eq(transactionsTable.status, params.data.status));
  }
  // No default status filter — show all statuses (success, pending, failed) so
  // failed/refunded purchases and pending withdrawals all appear in history.

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
    .where(and(eq(transactionsTable.userId, userId), inArray(transactionsTable.status, ["success", "pending"])))
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
