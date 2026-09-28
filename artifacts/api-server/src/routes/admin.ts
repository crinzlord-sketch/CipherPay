import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs/promises";
import { eq, desc, and, sql, like, or, count, isNotNull } from "drizzle-orm";
import {
  db,
  usersTable,
  walletsTable,
  transactionsTable,
  socialOrdersTable,
  smsActivationsTable,
  notificationsTable,
  kycTable,
  savedAccountsTable,
  supportChatsTable,
  supportMessagesTable,
} from "@workspace/db";
import { gt, ne } from "drizzle-orm";
import { signAdminToken, requireAdmin, type AdminRequest } from "../lib/admin-auth";
import { creditWallet, debitWallet, formatTransaction } from "../lib/wallet";
import { generateReference, generateReferralCode } from "../lib/auth";
import { notifyUser } from "../lib/notifications";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "../lib/email";
import { _typingAgentThrottle, clearSupportChat } from "./support";

const router: IRouter = Router();

// ── AUTH ─────────────────────────────────────────────────────────────────────
router.post("/admin/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, String(email).toLowerCase()));
  if (!user || !user.isAdmin) { res.status(401).json({ error: "Invalid admin credentials" }); return; }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) { res.status(401).json({ error: "Invalid admin credentials" }); return; }

  const token = signAdminToken(user.id);
  res.json({
    token,
    admin: {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    },
  });
});

router.get("/admin/me", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const a = req.admin!;
  res.json({ id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName });
});

router.get("/admin/admins", requireAdmin, async (_req: AdminRequest, res): Promise<void> => {
  const admins = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      isVerified: usersTable.isVerified,
      isSuspended: usersTable.isSuspended,
    })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true))
    .orderBy(usersTable.firstName, usersTable.lastName, usersTable.id);

  const configuredMasterEmail = String(process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const masterId = (configuredMasterEmail
    ? admins.find((admin) => admin.email.toLowerCase() === configuredMasterEmail)?.id
    : undefined) ?? admins.reduce<number | undefined>((lowest, admin) => lowest === undefined || admin.id < lowest ? admin.id : lowest, undefined);

  res.json({ data: admins.map((admin) => ({ ...admin, isMaster: admin.id === masterId })) });
});

async function getMasterAdminId(): Promise<number | null> {
  const configuredMasterEmail = String(process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (configuredMasterEmail) {
    const [configured] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, configuredMasterEmail));
    if (configured) return configured.id;
  }

  const [firstAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true))
    .orderBy(usersTable.id)
    .limit(1);
  return firstAdmin?.id ?? null;
}

router.post("/admin/admins", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const firstName = String(body.firstName ?? "CipherPay").trim().slice(0, 80) || "CipherPay";
  const lastName = String(body.lastName ?? "Admin").trim().slice(0, 80) || "Admin";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." }); return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Admin passwords must be at least 8 characters." }); return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) { res.status(409).json({ error: "A user already exists with that email." }); return; }

  const [created] = await db.insert(usersTable).values({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    firstName,
    lastName,
    phone: "",
    isVerified: true,
    isAdmin: true,
    kycLevel: 3,
    referralCode: generateReferralCode(),
  }).returning({
    id: usersTable.id,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    isAdmin: usersTable.isAdmin,
  });

  res.status(201).json({ success: true, admin: created });
});

router.delete("/admin/admins/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid admin id" }); return; }
  if (id === req.admin!.id) { res.status(400).json({ error: "You cannot remove the admin account you are currently using." }); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target || !target.isAdmin) { res.status(404).json({ error: "Admin account not found" }); return; }

  const masterId = await getMasterAdminId();
  if (id === masterId) {
    res.status(403).json({ error: "The master admin cannot be removed." });
    return;
  }

  await db.transaction(async (trx) => {
    await trx.delete(transactionsTable).where(eq(transactionsTable.userId, id));
    await trx.delete(socialOrdersTable).where(eq(socialOrdersTable.userId, id));
    await trx.delete(smsActivationsTable).where(eq(smsActivationsTable.userId, id));
    await trx.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await trx.delete(savedAccountsTable).where(eq(savedAccountsTable.userId, id));
    await trx.delete(kycTable).where(eq(kycTable.userId, id));
    await trx.delete(walletsTable).where(eq(walletsTable.userId, id));
    await trx.delete(usersTable).where(eq(usersTable.id, id));
  });

  res.json({ success: true, message: `Admin ${target.email} removed.` });
});

// ── EGRESS IP (diagnostics) ──────────────────────────────────────────────────
// Flutterwave pay/transfer calls (POST /v3/bills, /v3/transfers) require the
// caller's egress IP to be whitelisted in the Flutterwave dashboard. Dev and
// prod egress IPs differ, and a Reserved VM is needed for a stable prod IP.
// This endpoint reports the server's current outbound IP so an admin can copy
// the exact value to whitelist after publishing to a Reserved VM deployment.
router.get("/admin/egress-ip", requireAdmin, async (req, res): Promise<void> => {
  const sources = ["https://api.ipify.org?format=json", "https://ifconfig.co/json"];
  for (const url of sources) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) continue;
      const body: any = await resp.json().catch(() => ({}));
      const ip = body?.ip ?? null;
      if (ip) {
        res.json({ ip: String(ip), checkedAt: new Date().toISOString(), source: url });
        return;
      }
    } catch (e: any) {
      req.log.warn({ err: e?.message, url }, "egress-ip lookup failed");
    }
  }
  res.status(502).json({ error: "Could not determine egress IP. Please try again." });
});

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [
    [uCount], [tCount], [pendingTx], [flaggedTx], [walletSum], [pendingWithdraw],
    [transferFees], [withdrawFees], [vasCount],
  ] = await Promise.all([
    db.select({ c: count() }).from(usersTable),
    db.select({ c: count() }).from(transactionsTable),
    db.select({ c: count() }).from(transactionsTable).where(eq(transactionsTable.status, "pending")),
    db.select({ c: count() }).from(transactionsTable).where(eq(transactionsTable.isFlagged, true)),
    db.select({ s: sql<string>`coalesce(sum(${walletsTable.balance}),0)` }).from(walletsTable),
    db.select({ c: count() }).from(transactionsTable).where(and(eq(transactionsTable.type, "withdraw"), eq(transactionsTable.status, "pending"))),
    // Fees collected from P2P transfers (stored per-tx in the fee column)
    db.select({ s: sql<string>`coalesce(sum(${transactionsTable.fee}),0)` }).from(transactionsTable)
      .where(and(eq(transactionsTable.type, "transfer_out"), eq(transactionsTable.status, "success"))),
    // Fees collected from withdrawals — include pending because wallet was already debited
    db.select({ s: sql<string>`coalesce(sum(${transactionsTable.fee}),0)` }).from(transactionsTable)
      .where(and(eq(transactionsTable.type, "withdraw"), ne(transactionsTable.status, "failed"))),
    // Successful airtime + data purchases (₦50 profit margin baked into each)
    db.select({ c: count() }).from(transactionsTable)
      .where(and(
        or(eq(transactionsTable.type, "airtime"), eq(transactionsTable.type, "data")),
        eq(transactionsTable.status, "success"),
      )),
  ]);

  const totalTransferFees = parseFloat(String(transferFees?.s ?? "0"));
  const totalWithdrawalFees = parseFloat(String(withdrawFees?.s ?? "0"));
  const totalVasProfit = Number(vasCount?.c ?? 0) * 50; // ₦50 flat margin per VAS tx
  const totalIncome = totalTransferFees + totalWithdrawalFees + totalVasProfit;

  res.json({
    users: Number(uCount?.c ?? 0),
    transactions: Number(tCount?.c ?? 0),
    pendingTransactions: Number(pendingTx?.c ?? 0),
    flaggedTransactions: Number(flaggedTx?.c ?? 0),
    pendingWithdrawals: Number(pendingWithdraw?.c ?? 0),
    totalWalletBalance: parseFloat(String(walletSum?.s ?? "0")),
    totalTransferFees,
    totalWithdrawalFees,
    totalVasProfit,
    totalIncome,
  });
});

// ── USERS ────────────────────────────────────────────────────────────────────
router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  const where = q
    ? or(
      like(usersTable.email, `%${q}%`),
      like(usersTable.firstName, `%${q}%`),
      like(usersTable.lastName, `%${q}%`),
      like(usersTable.phone, `%${q}%`),
    )
    : undefined;

  const rows = await db
    .select({
      id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName,
      phone: usersTable.phone, isVerified: usersTable.isVerified, kycLevel: usersTable.kycLevel,
      isAdmin: usersTable.isAdmin, isSuspended: usersTable.isSuspended, suspendReason: usersTable.suspendReason,
      createdAt: usersTable.createdAt, balance: walletsTable.balance,
    })
    .from(usersTable)
    .leftJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
    .where(where as any)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit).offset(offset);

  res.json({
    data: rows.map(r => ({
      ...r,
      balance: r.balance ? parseFloat(r.balance) : 0,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

router.post("/admin/users/:id/suspend", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { suspended, reason } = req.body ?? {};
  const [u] = await db.update(usersTable)
    .set({ isSuspended: !!suspended, suspendReason: suspended ? (reason ?? null) : null })
    .where(eq(usersTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ success: true, isSuspended: u.isSuspended });
});

router.post("/admin/users/:id/set-admin", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { isAdmin } = req.body ?? {};
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  if (!isAdmin) {
    const masterId = await getMasterAdminId();
    if (id === masterId) {
      res.status(403).json({ error: "The master admin cannot be demoted." }); return;
    }
  }

  const [u] = await db.update(usersTable).set({ isAdmin: !!isAdmin }).where(eq(usersTable.id, id)).returning();
  res.json({ success: true, isAdmin: u.isAdmin });
});

// Admin-initiated user debit: pulls funds from a user's wallet into the
// signed-in admin's own wallet. Used for billing the user for off-platform
// work, correcting balance errors that resulted in unowed credit, or moving
// revenue into the operator's account. The debit reason is REQUIRED and is
// shown to the user in their transaction history + notification.
// Short-window idempotency cache for the debit endpoint. Holds the last
// successful response for an `Idempotency-Key` (scoped by admin id) for a
// few minutes so a network retry from the client doesn't double-charge the
// user. Process-local — good enough for accidental double submits; not a
// distributed lock. Keys older than the TTL are evicted lazily on read.
const DEBIT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const debitIdempotency = new Map<string, { at: number; status: number; body: unknown }>();
function idempKey(adminId: number, raw: string) { return `${adminId}:${raw}`; }
function getIdempotent(adminId: number, raw: string | undefined) {
  if (!raw) return null;
  const k = idempKey(adminId, raw);
  const hit = debitIdempotency.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > DEBIT_IDEMPOTENCY_TTL_MS) { debitIdempotency.delete(k); return null; }
  return hit;
}
function putIdempotent(adminId: number, raw: string | undefined, status: number, body: unknown) {
  if (!raw) return;
  debitIdempotency.set(idempKey(adminId, raw), { at: Date.now(), status, body });
}

router.post("/admin/users/:id/debit-to-admin", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = (req.body ?? {}) as { amount?: number; description?: string };
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim().slice(0, 280);
  if (!(amount > 0)) { res.status(400).json({ error: "Amount must be a positive number" }); return; }
  if (!Number.isFinite(amount)) { res.status(400).json({ error: "Amount must be finite" }); return; }
  if (!description) { res.status(400).json({ error: "Description is required" }); return; }
  if (id === req.admin!.id) { res.status(400).json({ error: "Cannot debit yourself" }); return; }

  // Round to 2dp so we never persist sub-kobo amounts that drift the ledger.
  const amt = Math.round(amount * 100) / 100;

  // Idempotency replay: if the client sent the same key recently, return the
  // original response without touching the ledger again.
  const idempHeader = (req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"]) as string | undefined;
  const replay = getIdempotent(req.admin!.id, idempHeader);
  if (replay) { res.status(replay.status).json(replay.body); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  // Both legs of the ledger run in a single DB transaction. We lock both
  // wallet rows FOR UPDATE (ordered by user id to avoid deadlocks when two
  // admins debit each other), recompute the balance from the locked row,
  // then write both updates and both ledger rows. If anything throws, the
  // transaction rolls back and neither wallet is touched. Wallet helpers
  // are not used here because they read with the global `db` handle and
  // would bypass our row lock.
  try {
    const result = await db.transaction(async (txdb) => {
      // Ensure both wallets exist before locking.
      await getOrCreateWalletTx(txdb, id);
      await getOrCreateWalletTx(txdb, req.admin!.id);
      const [first, second] = [id, req.admin!.id].sort((a, b) => a - b);
      const locked = await txdb.execute<{ user_id: number; balance: string }>(
        sql`select user_id, balance from wallets where user_id in (${first}, ${second}) for update`,
      );
      const rows = (locked as any).rows ?? (locked as any);
      const userRow = rows.find((r: any) => Number(r.user_id) === id);
      const adminRow = rows.find((r: any) => Number(r.user_id) === req.admin!.id);
      if (!userRow || !adminRow) throw new Error("Wallet lock failed");

      const userBefore = parseFloat(userRow.balance);
      const adminBefore = parseFloat(adminRow.balance);
      if (userBefore < amt) {
        const err: any = new Error("Insufficient balance"); err.code = "INSUFFICIENT"; throw err;
      }
      const userAfter = Math.round((userBefore - amt) * 100) / 100;
      const adminAfter = Math.round((adminBefore + amt) * 100) / 100;

      await txdb.update(walletsTable).set({ balance: userAfter.toFixed(2), ledgerBalance: userAfter.toFixed(2) }).where(eq(walletsTable.userId, id));
      await txdb.update(walletsTable).set({ balance: adminAfter.toFixed(2), ledgerBalance: adminAfter.toFixed(2) }).where(eq(walletsTable.userId, req.admin!.id));

      const [debitTx] = await txdb.insert(transactionsTable).values({
        userId: id, type: "admin_debit", amount: amt.toFixed(2), status: "success",
        reference: generateReference("DR"),
        // User-facing description is just the admin's text — they shouldn't
        // see "Admin debit:" as a prefix. The fact that an admin did this is
        // preserved in metadata (and in the type) for audit/admin views.
        description,
        metadata: JSON.stringify({ adminId: req.admin!.id, adminEmail: req.admin!.email, description }),
        balanceBefore: userBefore.toFixed(2), balanceAfter: userAfter.toFixed(2),
      }).returning();
      const [creditTx] = await txdb.insert(transactionsTable).values({
        userId: req.admin!.id, type: "admin_collection", amount: amt.toFixed(2), status: "success",
        reference: generateReference("CR"),
        description: `Collected from ${target.email}: ${description}`,
        metadata: JSON.stringify({ fromUserId: id, fromUserEmail: target.email, sourceTxId: debitTx.id, description }),
        balanceBefore: adminBefore.toFixed(2), balanceAfter: adminAfter.toFixed(2),
      }).returning();

      return { debitTx, creditTx, userAfter, adminAfter };
    });

    // Notification is outside the transaction (best-effort, must not roll
    // back ledger entries if email is down).
    // Notify the user generically — they see this as a normal wallet
    // debit. The description carries the reason; the admin attribution is
    // recorded internally (in transaction metadata) for support/audit.
    await notifyUser({
      userId: id, type: "warning",
      title: `₦${amt.toLocaleString()} debited from wallet`,
      body: `${description}. New balance: ₦${result.userAfter.toLocaleString()}. Contact support if this looks wrong.`,
      link: `/transactions`,
      email: true,
    });

    const okBody = {
      success: true,
      amount: amt, description,
      user: { id, email: target.email, balanceAfter: result.userAfter, txId: result.debitTx.id },
      admin: { id: req.admin!.id, balanceAfter: result.adminAfter, txId: result.creditTx.id },
    };
    putIdempotent(req.admin!.id, idempHeader, 200, okBody);
    res.json(okBody);
  } catch (e: any) {
    if (e?.code === "INSUFFICIENT") {
      res.status(400).json({ error: e.message ?? "Insufficient balance", code: "INSUFFICIENT" });
      return;
    }
    res.status(500).json({ error: e?.message ?? "Debit failed" });
  }
});

async function getOrCreateWalletTx(txdb: any, userId: number) {
  const [w] = await txdb.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (w) return w;
  const [created] = await txdb.insert(walletsTable).values({ userId, balance: "0", ledgerBalance: "0", currency: "NGN" }).returning();
  return created;
}

// Admin removes a user's app-lock PIN (e.g. after verifying identity via
// support because the user forgot it). Does not log the user out — only
// clears the PIN so the next app open won't prompt for it.
router.post("/admin/users/:id/pin-clear", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const reason = String((req.body ?? {}).reason ?? "User-requested PIN reset").trim().slice(0, 280);
  const rows = await db.update(usersTable).set({ pinHash: null, pinUpdatedAt: null }).where(eq(usersTable.id, id)).returning({ id: usersTable.id, email: usersTable.email });
  if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  req.log?.info({ action: "admin.pin-clear", adminId: req.admin!.id, adminEmail: req.admin!.email, targetUserId: id, targetEmail: rows[0].email, reason }, "Admin cleared user PIN");
  await notifyUser({
    userId: id, type: "info",
    title: "App PIN removed",
    body: "Your app-lock PIN was cleared by support. You can set a new one in Settings.",
    email: true,
  });
  res.json({ success: true });
});

// Send a direct email to one user (custom subject + body). Does NOT create
// an in-app notification — use /notify for that. Good for formal comms like
// compliance notices, identity-verification follow-ups, etc.
router.post("/admin/users/:id/send-email", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const subject = String(req.body?.subject ?? "").trim();
  const message = String(req.body?.message ?? "").trim();
  if (!subject || !message) { res.status(400).json({ error: "subject and message are required" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  const { sendUserNotificationEmail, isEmailConfigured: cfg } = await import("../lib/email.js");
  if (!cfg()) { res.status(503).json({ error: "Email is not configured on this server" }); return; }
  try {
    await sendUserNotificationEmail(u.email, subject, message);
    req.log?.info({ action: "admin.send-email", adminId: req.admin!.id, adminEmail: req.admin!.email, targetUserId: id, targetEmail: u.email, subject }, "Admin sent email to user");
    res.json({ success: true, sentTo: u.email });
  } catch (e: any) {
    res.status(502).json({ error: `Failed to send email: ${e.message}` });
  }
});

// Explicitly credit a user's wallet (convenience wrapper around wallet-adjust for clarity).
router.post("/admin/users/:id/credit", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason ?? "").trim();
  if (!(amount > 0) || !Number.isFinite(amount)) { res.status(400).json({ error: "amount must be a positive number" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required for audit trail" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  try {
    await creditWallet(id, amount, reason, "admin_credit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason });
    await notifyUser({ userId: id, type: "success", title: `₦${amount.toLocaleString()} added to wallet`, body: reason, email: false });
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Credit failed" });
  }
});

// Explicitly debit a user's wallet (subtracts balance, creates debit tx, no transfer to admin).
router.post("/admin/users/:id/debit", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (id === req.admin!.id) { res.status(400).json({ error: "Cannot debit yourself" }); return; }
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason ?? "").trim();
  if (!(amount > 0) || !Number.isFinite(amount)) { res.status(400).json({ error: "amount must be a positive number" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required for audit trail" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  try {
    await debitWallet(id, amount, reason, "admin_debit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason });
    await notifyUser({ userId: id, type: "warning", title: `₦${amount.toLocaleString()} debited from wallet`, body: reason, email: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Debit failed" });
  }
});

router.post("/admin/users/:id/wallet-adjust", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason ?? "").trim();
  if (!Number.isFinite(amount) || amount === 0) { res.status(400).json({ error: "amount must be a non-zero number" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required for audit trail" }); return; }

  try {
    // User-facing description is just the reason — they don't need to see
    // who the admin was. Admin attribution lives in metadata.
    if (amount > 0) {
      await creditWallet(id, amount, reason, "admin_credit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason });
      await notifyUser({ userId: id, type: "success", title: `₦${amount.toLocaleString()} credited to wallet`, body: `${reason}` });
    } else {
      await debitWallet(id, Math.abs(amount), reason, "admin_debit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason });
      await notifyUser({ userId: id, type: "warning", title: `₦${Math.abs(amount).toLocaleString()} debited from wallet`, body: `${reason}`, email: true });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Adjustment failed" });
  }
});

// Force-set wallet balance to an exact amount (creates a single adjustment tx).
router.post("/admin/users/:id/wallet-set", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const newBalance = Number(req.body?.balance);
  const reason = String(req.body?.reason ?? "").trim() || "Admin balance override";
  if (!Number.isFinite(newBalance) || newBalance < 0) { res.status(400).json({ error: "balance must be a non-negative number" }); return; }

  const [w] = await db.select().from(walletsTable).where(eq(walletsTable.userId, id));
  const current = w ? parseFloat(w.balance) : 0;
  const delta = newBalance - current;
  if (Math.abs(delta) < 0.005) { res.json({ success: true, message: "No change", balance: current }); return; }

  // Same as wallet-adjust: user sees only the reason, not the admin tag.
  if (delta > 0) await creditWallet(id, delta, reason, "admin_credit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason, override: true, newBalance });
  else await debitWallet(id, Math.abs(delta), reason, "admin_debit", { adminId: req.admin!.id, adminEmail: req.admin!.email, reason, override: true, newBalance });
  await notifyUser({ userId: id, type: "admin", title: `Wallet balance updated to ₦${newBalance.toLocaleString()}`, body: `${reason}` });
  res.json({ success: true, balance: newBalance });
});

router.post("/admin/users/:id/verify", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const verified = !!req.body?.verified;
  const [u] = await db.update(usersTable).set({ isVerified: verified }).where(eq(usersTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  if (verified) await notifyUser({ userId: id, type: "success", title: "Email verified", body: "Your email has been verified by an administrator." });
  res.json({ success: true, isVerified: u.isVerified });
});

router.post("/admin/users/:id/set-kyc", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const level = parseInt(String(req.body?.level), 10);
  if (![0, 1, 2, 3].includes(level)) { res.status(400).json({ error: "level must be 0, 1, 2, or 3" }); return; }
  const [u] = await db.update(usersTable).set({ kycLevel: level }).where(eq(usersTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  await notifyUser({ userId: id, type: "success", title: `KYC level updated to L${level}`, body: `An administrator set your KYC level to ${level}. Higher tiers unlock larger transaction limits.` });
  res.json({ success: true, kycLevel: u.kycLevel });
});

// Reset user activity: wipe transactions, social orders, sms activations, zero wallet.
router.post("/admin/users/:id/reset-activity", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }

  await db.transaction(async (trx) => {
    await trx.delete(transactionsTable).where(eq(transactionsTable.userId, id));
    await trx.delete(socialOrdersTable).where(eq(socialOrdersTable.userId, id));
    await trx.delete(smsActivationsTable).where(eq(smsActivationsTable.userId, id));
    await trx.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await trx.update(walletsTable).set({ balance: "0", ledgerBalance: "0" }).where(eq(walletsTable.userId, id));
  });
  await notifyUser({ userId: id, type: "warning", title: "Account activity reset", body: `Your transaction history and wallet balance were reset by an administrator. Contact support if this is unexpected.`, email: true });
  res.json({ success: true, message: "User activity wiped" });
});

// Hard delete a user. Refuses to delete other admins unless ?force=true.
router.delete("/admin/users/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (id === req.admin!.id) { res.status(400).json({ error: "You cannot delete yourself" }); return; }
  const force = req.query.force === "true";
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  if (u.isAdmin) {
    const masterId = await getMasterAdminId();
    if (id === masterId) { res.status(403).json({ error: "The master admin cannot be removed." }); return; }
    if (!force) { res.status(400).json({ error: "Refusing to delete another admin without ?force=true" }); return; }
  }

  await db.transaction(async (trx) => {
    await trx.delete(transactionsTable).where(eq(transactionsTable.userId, id));
    await trx.delete(socialOrdersTable).where(eq(socialOrdersTable.userId, id));
    await trx.delete(smsActivationsTable).where(eq(smsActivationsTable.userId, id));
    await trx.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await trx.delete(savedAccountsTable).where(eq(savedAccountsTable.userId, id));
    await trx.delete(kycTable).where(eq(kycTable.userId, id));
    await trx.delete(walletsTable).where(eq(walletsTable.userId, id));
    await trx.delete(usersTable).where(eq(usersTable.id, id));
  });
  res.json({ success: true, message: `User #${id} (${u.email}) deleted` });
});

// Send a targeted notification (and optionally email) to one user.
router.post("/admin/users/:id/notify", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const email = !!req.body?.email;
  if (!title || !body) { res.status(400).json({ error: "title and body are required" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  await notifyUser({ userId: id, type: "admin", title, body, email });
  res.json({ success: true });
});

// Broadcast a notification to all users (or only verified, or only with balance > 0).
router.post("/admin/notifications/broadcast", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const filter = String(req.body?.filter ?? "all"); // all | verified | active
  const email = !!req.body?.email;
  if (!title || !body) { res.status(400).json({ error: "title and body are required" }); return; }

  let users: { id: number; email: string }[] = [];
  if (filter === "verified") {
    users = await db.select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.isVerified, true));
  } else if (filter === "active") {
    users = await db.select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable).leftJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
      .where(sql`coalesce(${walletsTable.balance}::numeric, 0) > 0`);
  } else {
    users = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable);
  }

  if (users.length > 0) {
    await db.insert(notificationsTable).values(
      users.map(u => ({ userId: u.id, title, body, type: "admin" as string, link: null as string | null }))
    );
  }
  // Fire-and-forget email (don't block response on hundreds of SMTP calls).
  if (email) {
    void (async () => {
      const { sendUserNotificationEmail, isEmailConfigured: cfg } = await import("../lib/email.js");
      if (!cfg()) return;
      for (const u of users) {
        try { await sendUserNotificationEmail(u.email, title, body); } catch { /* skip */ }
      }
    })();
  }
  res.json({ success: true, recipients: users.length, emailQueued: email });
});

// ── TRANSACTIONS ─────────────────────────────────────────────────────────────
router.get("/admin/transactions", requireAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const status = req.query.status ? String(req.query.status) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : null;
  const flagged = req.query.flagged === "true";

  const conds: any[] = [];
  if (status) conds.push(eq(transactionsTable.status, status));
  if (type) conds.push(eq(transactionsTable.type, type));
  if (userId) conds.push(eq(transactionsTable.userId, userId));
  if (flagged) conds.push(eq(transactionsTable.isFlagged, true));

  const rows = await db.select({
    tx: transactionsTable,
    userEmail: usersTable.email,
    userName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`.as("user_name"),
  })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(usersTable.id, transactionsTable.userId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit).offset(offset);

  res.json({
    data: rows.map(r => ({
      ...formatTransaction(r.tx),
      isFlagged: r.tx.isFlagged,
      flagReason: r.tx.flagReason,
      userEmail: r.userEmail,
      userName: r.userName,
    })),
  });
});

router.post("/admin/transactions/:id/flag", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { flagged, reason } = req.body ?? {};
  const [tx] = await db.update(transactionsTable)
    .set({ isFlagged: !!flagged, flagReason: flagged ? (reason ?? null) : null })
    .where(eq(transactionsTable.id, id)).returning();
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  res.json({ success: true, isFlagged: tx.isFlagged });
});

router.post("/admin/transactions/:id/mark-success", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [pending] = await db.select({ type: transactionsTable.type, isFlagged: transactionsTable.isFlagged })
    .from(transactionsTable).where(eq(transactionsTable.id, id));
  if (pending?.type === "fund" && pending.isFlagged) {
    res.status(400).json({ error: "Flagged deposits must be released from the deposit queue after payment and KYC review." }); return;
  }
  const [tx] = await db.update(transactionsTable)
    .set({ status: "success" })
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
    .returning();
  if (!tx) { res.status(400).json({ error: "Transaction not found or no longer pending" }); return; }
  res.json({ success: true, transaction: formatTransaction(tx) });
});

router.post("/admin/transactions/:id/mark-failed-refund", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const reason = String(req.body?.reason ?? "Marked failed by admin");

  const refunded = await db.update(transactionsTable)
    .set({ status: "failed", description: sql`${transactionsTable.description} || ' — ' || ${reason}` })
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
    .returning();
  if (refunded.length === 0) { res.status(400).json({ error: "Transaction not pending; cannot refund" }); return; }

  const tx = refunded[0];
  // Refund only debit-type transactions (withdraw, airtime, data, bill, social, sms, transfer_out).
  const debitTypes = new Set(["withdraw", "airtime", "data", "bill", "social", "sms", "transfer_out", "admin_debit"]);
  if (debitTypes.has(tx.type)) {
    const amt = parseFloat(tx.amount);
    await creditWallet(tx.userId, amt, `Refund (admin): ${reason} — tx #${tx.id}`, "refund", { adminId: req.admin!.id, originalTxId: tx.id, type: tx.type });
  }
  res.json({ success: true });
});

// ── DEPOSITS ─────────────────────────────────────────────────────────────────
// List fund transactions that are still pending (e.g. user paid but verify
// was never called, or Paystack callback missed).
router.get("/admin/deposits/pending", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({ tx: transactionsTable, userEmail: usersTable.email, userName: sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`.as("user_name") })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(usersTable.id, transactionsTable.userId))
    .where(and(
      eq(transactionsTable.type, "fund"),
      eq(transactionsTable.status, "pending"),
    ))
    .orderBy(desc(transactionsTable.createdAt));
  res.json({ data: rows.map(r => ({ ...formatTransaction(r.tx), isFlagged: r.tx.isFlagged, flagReason: r.tx.flagReason, userEmail: r.userEmail, userName: r.userName })) });
});

// Approve a pending deposit: MUST re-verify with Flutterwave first. Deposits are
// auto-credited via the hosted-checkout verify endpoint and webhook, so this is a
// break-glass path for funds that paid but never finalized. We never credit
// without a live "successful" charge — an admin cannot grant free balance on an
// unpaid checkout intent.
router.post("/admin/deposits/:id/approve", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [tx] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "fund"), eq(transactionsTable.status, "pending")));
  if (!tx) { res.status(404).json({ error: "Pending fund transaction not found" }); return; }

  // Manual bank-transfer deposits have no Flutterwave charge to verify — the
  // admin is vouching that the money landed in our fixed account. Card
  // (provider:"flutterwave") deposits are still re-verified before crediting.
  let isManual = false;
  let isPsa = false;
  try {
    const meta = tx.metadata ? JSON.parse(tx.metadata) : {};
    isManual = meta.provider === "manual-bank-transfer";
    isPsa = meta.provider === "flutterwave-psa";
  } catch { /* ignore */ }

  if (!isManual && !isPsa) {
    // Verify the charge with Flutterwave before crediting anything.
    const { verifyByReference } = await import("../lib/flutterwave.js");
    let flwTx;
    try {
      flwTx = await verifyByReference(tx.reference);
    } catch (e: any) {
      res.status(502).json({ error: e?.message ?? "Flutterwave verification failed" });
      return;
    }
    if (flwTx.status !== "successful") {
      res.status(400).json({ error: `Payment not completed (status: ${flwTx.status}); cannot approve` });
      return;
    }
    const expectedAmount = parseFloat(tx.amount);
    if (flwTx.amount + 0.001 < expectedAmount) {
      res.status(400).json({ error: "Amount mismatch — cannot approve" });
      return;
    }
    if (flwTx.currency !== "NGN") {
      res.status(400).json({ error: "Currency mismatch — cannot approve" });
      return;
    }
  }

  // Credit wallet and mark success atomically (atomic SQL increment).
  try {
    await (await import("../lib/wallet")).getOrCreateWallet(tx.userId); // ensure wallet row exists
    const credited = await db.transaction(async (dbtx) => {
      const updated = await dbtx.update(transactionsTable)
        .set({ status: "success", isFlagged: false, flagReason: null })
        .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
        .returning({ id: transactionsTable.id });
      if (updated.length === 0) return false;

      const amt = parseFloat(tx.amount);
      const [w] = await dbtx.update(walletsTable)
        .set({
          balance: sql`${walletsTable.balance} + ${amt}`,
          ledgerBalance: sql`${walletsTable.ledgerBalance} + ${amt}`,
        })
        .where(eq(walletsTable.userId, tx.userId))
        .returning({ balance: walletsTable.balance });
      const balanceAfter = parseFloat(w.balance);
      const balanceBefore = balanceAfter - amt;
      await dbtx.update(transactionsTable)
        .set({ balanceBefore: balanceBefore.toFixed(2), balanceAfter: balanceAfter.toFixed(2) })
        .where(eq(transactionsTable.id, id));
      return true;
    });
    if (!credited) { res.status(409).json({ error: "Transaction was already processed" }); return; }
    await notifyUser({ userId: tx.userId, type: "success", title: "Deposit approved ✅", body: `Your deposit of ₦${parseFloat(tx.amount).toLocaleString()} has been approved and credited to your wallet.` }).catch(() => {});
    // Dedicated status email to the affected user — best-effort, never blocks.
    try {
      const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, tx.userId));
      if (u?.email) {
        await sendUserNotificationEmail(
          u.email,
          "Your deposit has been approved",
          `Your deposit of ₦${parseFloat(tx.amount).toLocaleString()} has been confirmed and credited to your CipherPay wallet.\n\n` +
            `Reference: ${tx.reference}\n\nThank you for using CipherPay.`,
        );
      }
    } catch (e: any) {
      req.log?.warn?.({ err: e?.message, userId: tx.userId }, "deposit approval email failed");
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Approval failed" });
  }
});

// Decline a pending deposit — marks it failed with no wallet change
router.post("/admin/deposits/:id/decline", requireAdmin, async (_req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(_req.params.id), 10);
  const [tx] = await db.update(transactionsTable)
    .set({ status: "failed" })
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "fund"), eq(transactionsTable.status, "pending")))
    .returning();
  if (!tx) { res.status(404).json({ error: "Pending fund transaction not found" }); return; }
  await notifyUser({ userId: tx.userId, type: "error", title: "Deposit declined", body: `Your deposit of ₦${parseFloat(tx.amount).toLocaleString()} could not be confirmed. Please contact support if you believe this is an error.` }).catch(() => {});
  // Dedicated status email to the affected user — best-effort, never blocks.
  try {
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, tx.userId));
    if (u?.email) {
      await sendUserNotificationEmail(
        u.email,
        "Your deposit could not be confirmed",
        `Unfortunately your deposit of ₦${parseFloat(tx.amount).toLocaleString()} could not be confirmed.\n\n` +
          `Reference: ${tx.reference}\n\n` +
          `If you believe this is an error, please contact support with your payment receipt.`,
      );
    }
  } catch (e: any) {
    _req.log?.warn?.({ err: e?.message, userId: tx.userId }, "deposit decline email failed");
  }
  res.json({ success: true });
});

// ── WITHDRAWALS ──────────────────────────────────────────────────────────────
router.get("/admin/withdrawals/pending", requireAdmin, async (_req, res): Promise<void> => {
  // Returns recent withdrawals (all statuses) so the admin panel is a read-only
  // history view. Payments are now fully automated via Flutterwave — there is no
  // manual approve/reject step. Limited to the last 100 for performance.
  const rows = await db.select({ tx: transactionsTable, userEmail: usersTable.email })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(usersTable.id, transactionsTable.userId))
    .where(eq(transactionsTable.type, "withdraw"))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(100);

  res.json({ data: rows.map(r => ({ ...formatTransaction(r.tx), userEmail: r.userEmail })) });
});

// Approve a user-submitted withdrawal: manual payout. The user's wallet was
// already debited at request time, so approval simply confirms the admin has
// paid out to the bank and marks the transaction completed.
router.post("/admin/withdrawals/:id/approve", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!tx || tx.type !== "withdraw") { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.status !== "pending") { res.status(409).json({ error: `Already ${tx.status}` }); return; }

  let meta: any = {};
  try { meta = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch { /* ignore */ }
  if (!meta.awaitingApproval) { res.status(409).json({ error: "This withdrawal is not awaiting approval (likely already processed by an older flow)." }); return; }
  const { bankCode, accountNumber, accountName, fee = 0 } = meta;
  if (!bankCode || !accountNumber || !accountName) { res.status(400).json({ error: "Withdrawal metadata is missing bank details" }); return; }

  const grossDebit = parseFloat(tx.amount); // amount + fee
  const netAmount = grossDebit - Number(fee || 0);
  if (!(netAmount > 0)) { res.status(400).json({ error: "Computed net amount is invalid" }); return; }

  // CAS claim: only one admin may successfully finalize this row. We add a LIKE
  // predicate on the metadata text so a concurrent claim by another admin (who
  // passed the earlier checks) is rejected at the DB level — two passes through
  // the prechecks cannot both win the update.
  const claim = await db.update(transactionsTable)
    .set({
      status: "success",
      metadata: JSON.stringify({
        bankCode, accountNumber, accountName, fee,
        awaitingApproval: false, payoutMethod: "manual",
        approvedByAdminId: req.admin!.id, approvedAt: new Date().toISOString(),
      }),
    })
    .where(and(
      eq(transactionsTable.id, id),
      eq(transactionsTable.status, "pending"),
      like(transactionsTable.metadata, '%"awaitingApproval":true%'),
    ))
    .returning({ id: transactionsTable.id });
  if (claim.length === 0) { res.status(409).json({ error: "Withdrawal was claimed by another admin or already finalized" }); return; }

  await notifyUser({
    userId: tx.userId,
    type: "transaction",
    title: "Withdrawal completed",
    body: `₦${netAmount.toLocaleString()} → ${accountName} (${accountNumber}) has been paid out.`,
    link: `/transactions`,
  });

  // Dedicated status email to the affected user — best-effort, never blocks.
  try {
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, tx.userId));
    if (u?.email) {
      await sendUserNotificationEmail(
        u.email,
        "Your withdrawal has been processed",
        `Good news! Your withdrawal of ₦${netAmount.toLocaleString()} has been processed and paid out to:\n\n` +
          `${accountName}\n${accountNumber}\n\nThank you for using CipherPay.`,
      );
    }
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message, userId: tx.userId }, "withdrawal approval email failed");
  }

  res.json({ success: true, status: "success" });
});

// Reject a pending withdrawal: refund the user's wallet (amount + fee) and mark
// the transaction failed with an optional admin-supplied reason.
router.post("/admin/withdrawals/:id/reject", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const reason = String((req.body ?? {}).reason ?? "").slice(0, 280) || "Rejected by admin";

  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!tx || tx.type !== "withdraw") { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.status !== "pending") { res.status(409).json({ error: `Already ${tx.status}` }); return; }
  // Reject is only valid while the withdrawal is still awaiting approval. The
  // CAS predicate below also enforces this; this check just gives a clearer
  // error message.
  if (!tx.metadata || !tx.metadata.includes('"awaitingApproval":true')) {
    res.status(409).json({ error: "Cannot reject — this withdrawal has already been finalized." }); return;
  }

  // CAS-guarded mark-failed; the refund only happens if we won the race AND
  // the row is still awaiting approval (i.e. no admin has approved between
  // our read above and this update).
  const failed = await db.update(transactionsTable)
    .set({ status: "failed", description: `Rejected by admin: ${reason}` })
    .where(and(
      eq(transactionsTable.id, id),
      eq(transactionsTable.status, "pending"),
      like(transactionsTable.metadata, '%"awaitingApproval":true%'),
    ))
    .returning({ id: transactionsTable.id });
  if (failed.length === 0) { res.status(409).json({ error: "Withdrawal was already approved or finalized by another admin" }); return; }

  const grossDebit = parseFloat(tx.amount);
  await creditWallet(tx.userId, grossDebit, `Refund: Withdrawal rejected (${reason})`, "refund", { originalTxId: id, type: "withdraw", adminId: req.admin!.id, reason });

  await notifyUser({
    userId: tx.userId, type: "warning",
    title: "Withdrawal rejected",
    body: `Your withdrawal request was rejected: ${reason}. ₦${grossDebit.toLocaleString()} has been returned to your wallet.`,
    link: `/transactions`,
  });

  // Dedicated status email to the affected user — best-effort, never blocks.
  try {
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, tx.userId));
    if (u?.email) {
      await sendUserNotificationEmail(
        u.email,
        "Your withdrawal request was declined",
        `Unfortunately your withdrawal of ₦${grossDebit.toLocaleString()} could not be processed.\n\n` +
          `Reason: ${reason}\n\n` +
          `The full amount of ₦${grossDebit.toLocaleString()} has been refunded to your CipherPay wallet.`,
      );
    }
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message, userId: tx.userId }, "withdrawal rejection email failed");
  }

  res.json({ success: true, refunded: grossDebit });
});

router.post("/admin/withdrawals/:id/reconcile", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [tx] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!tx || tx.type !== "withdraw") { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.status !== "pending") { res.json({ success: true, message: `Already ${tx.status}`, status: tx.status }); return; }

  let meta: any = {};
  try { meta = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch { /* ignore */ }
  const flwTransferId = meta.flwTransferId;
  if (!flwTransferId) { res.status(400).json({ error: "No Flutterwave transfer id on this transaction" }); return; }

  try {
    const { verifyTransferById } = await import("../lib/flutterwave.js");
    const result = await verifyTransferById(flwTransferId);
    const status = String(result.status ?? "").toUpperCase();

    if (status === "SUCCESSFUL") {
      const updated = await db.update(transactionsTable).set({ status: "success" })
        .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
        .returning();
      if (updated.length === 0) {
        const [now] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
        res.json({ success: true, status: now?.status ?? "unknown", message: "Already finalized by webhook" });
        return;
      }
      res.json({ success: true, status: "success", message: "Transfer confirmed" });
      return;
    }
    if (status === "FAILED") {
      const refunded = await db.update(transactionsTable)
        .set({ status: "failed", description: `${tx.description} — failed (admin reconcile)` })
        .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
        .returning();
      if (refunded.length > 0) {
        await creditWallet(tx.userId, parseFloat(tx.amount), `Refund: Withdrawal failed (admin reconcile, tx #${id})`, "refund", { adminId: req.admin!.id, originalTxId: id });
      }
      res.json({ success: true, status: "failed", message: "Marked failed + refunded" });
      return;
    }
    res.json({ success: true, status: result.status, message: `Still ${result.status ?? "pending"} — no action taken` });
  } catch (e: any) {
    res.status(502).json({ error: `Flutterwave verify failed: ${e?.message ?? "unknown"}` });
  }
});

// ── WITHDRAWAL BULK RECONCILE ─────────────────────────────────────────────────
// Checks every pending withdrawal against Flutterwave and updates status.
// Call this when the admin panel loads — works around missed webhooks in dev.
router.post("/admin/withdrawals/reconcile-all", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const pending = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.type, "withdraw"), eq(transactionsTable.status, "pending")))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);

  if (pending.length === 0) { res.json({ success: true, checked: 0, updated: 0, failed: 0, skipped: 0 }); return; }

  const { verifyTransferById } = await import("../lib/flutterwave.js");
  let updated = 0, failed = 0, skipped = 0;

  for (const tx of pending) {
    let meta: any = {};
    try { meta = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch { /* ignore */ }
    const flwTransferId = meta.flwTransferId;
    if (!flwTransferId) { skipped++; continue; }

    try {
      const result = await verifyTransferById(flwTransferId);
      const flwStatus = String(result.status ?? "").toUpperCase();

      if (flwStatus === "SUCCESSFUL") {
        const rows = await db.update(transactionsTable).set({ status: "success" })
          .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
          .returning({ id: transactionsTable.id });
        if (rows.length > 0) {
          updated++;
          const netAmount = Math.abs(parseFloat(tx.amount));
          const acctName = String(meta.accountName ?? "");
          const acctNum = String(meta.accountNumber ?? "");
          const recipient = acctName ? `${acctName} (${acctNum})` : acctNum;
          await notifyUser({
            userId: tx.userId, type: "success", title: "Withdrawal sent",
            body: `Your ₦${netAmount.toLocaleString()} withdrawal to ${recipient} has been sent successfully.`,
            link: `/transactions/${tx.id}`,
          });
        }
      } else if (flwStatus === "FAILED") {
        const rows = await db.update(transactionsTable)
          .set({ status: "failed", description: `${tx.description ?? "Withdrawal"} — failed` })
          .where(and(eq(transactionsTable.id, tx.id), eq(transactionsTable.status, "pending")))
          .returning({ id: transactionsTable.id });
        if (rows.length > 0) {
          failed++;
          await creditWallet(tx.userId, Math.abs(parseFloat(tx.amount)), `Refund: Withdrawal failed (tx #${tx.id})`, "refund", { originalTxId: tx.id });
          await notifyUser({
            userId: tx.userId, type: "error", title: "Withdrawal failed — refunded",
            body: `Your ₦${Math.abs(parseFloat(tx.amount)).toLocaleString()} withdrawal failed. The amount has been refunded to your wallet.`,
            link: `/transactions/${tx.id}`,
          });
        }
      }
    } catch (e: any) {
      req.log?.warn?.({ txId: tx.id, err: e?.message }, "reconcile-all: single tx verify failed");
    }
  }

  res.json({ success: true, checked: pending.length, updated, failed, skipped });
});

// ── WITHDRAWAL HISTORY CLEAR ──────────────────────────────────────────────────
router.delete("/admin/withdrawals", requireAdmin, async (_req, res): Promise<void> => {
  // Only deletes completed (success/failed) withdrawals — never touches pending ones.
  const deleted = await db.delete(transactionsTable)
    .where(and(
      eq(transactionsTable.type, "withdraw"),
      or(eq(transactionsTable.status, "success"), eq(transactionsTable.status, "failed")),
    ))
    .returning({ id: transactionsTable.id });
  res.json({ success: true, deleted: deleted.length });
});

// ── SYSTEM RESET ─────────────────────────────────────────────────────────────
// NUCLEAR: truncates all user data. Requires a confirmation header.
router.post("/admin/system/reset", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const confirm = req.headers["x-reset-confirm"];
  if (confirm !== "RESET_CIPHERPAY_SYSTEM") {
    res.status(400).json({ error: "Missing or incorrect confirmation — set header x-reset-confirm: RESET_CIPHERPAY_SYSTEM" });
    return;
  }
  await db.execute(sql`
    TRUNCATE sms_activations, social_orders, notifications, transactions, wallets, kyc,
             saved_accounts, support_messages, support_chats, sessions, otp,
             gift_card_orders, ads
    RESTART IDENTITY CASCADE
  `);
  await db.delete(usersTable).where(eq(usersTable.isAdmin, false));
  req.log?.warn?.({ adminId: req.admin!.id }, "SYSTEM RESET performed");
  res.json({ success: true, message: "System reset complete. All user data wiped. Admin account preserved." });
});

// ── SOCIAL ORDERS ────────────────────────────────────────────────────────────
router.get("/admin/social-orders", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({ o: socialOrdersTable, userEmail: usersTable.email })
    .from(socialOrdersTable)
    .leftJoin(usersTable, eq(usersTable.id, socialOrdersTable.userId))
    .orderBy(desc(socialOrdersTable.createdAt))
    .limit(200);
  res.json({ data: rows.map(r => ({ ...r.o, amount: parseFloat(r.o.amount), userEmail: r.userEmail, createdAt: r.o.createdAt.toISOString() })) });
});

// ── KYC REVIEW QUEUE ─────────────────────────────────────────────────────────
router.get("/admin/kyc", requireAdmin, async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "submitted");
  const rows = await db.select({ k: kycTable, userEmail: usersTable.email, userFirst: usersTable.firstName, userLast: usersTable.lastName, userPhone: usersTable.phone })
    .from(kycTable)
    .leftJoin(usersTable, eq(usersTable.id, kycTable.userId))
    .where(status === "all" ? sql`1=1` : eq(kycTable.status, status))
    .orderBy(desc(kycTable.submittedAt))
    .limit(200);
  res.json({
    data: rows.map(r => ({
      ...r.k,
      userEmail: r.userEmail, userFirst: r.userFirst, userLast: r.userLast, userPhone: r.userPhone,
      submittedAt: r.k.submittedAt?.toISOString() ?? null,
      verifiedAt: r.k.verifiedAt?.toISOString() ?? null,
      createdAt: r.k.createdAt.toISOString(),
    })),
  });
});

router.post("/admin/kyc/:id/approve", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [row] = await db.select().from(kycTable).where(eq(kycTable.id, id));
  if (!row) { res.status(404).json({ error: "KYC record not found" }); return; }
  const defaultLevel = row.documentType === "bvn" || row.documentType === "nin" ? 1 : 2;
  const level = Math.min(2, Math.max(1, parseInt(String(req.body?.level ?? defaultLevel), 10) || defaultLevel));
  if (row.status !== "submitted") { res.status(409).json({ error: `Cannot approve a submission in '${row.status}' state. The user may have resubmitted — refresh the queue.` }); return; }
  const updated = await db.update(kycTable)
    .set({ status: "verified", level, verifiedAt: new Date(), rejectionReason: null, reviewedBy: req.admin?.id ?? null })
    .where(and(eq(kycTable.id, id), eq(kycTable.status, "submitted")))
    .returning({ id: kycTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "Submission state changed — refresh and try again." }); return; }
  await db.update(usersTable).set({ kycLevel: level, isVerified: true }).where(eq(usersTable.id, row.userId));
  await notifyUser({ userId: row.userId, type: "success", title: "KYC approved 🎉", body: `Your identity has been verified. You're now KYC Level ${level} with higher limits unlocked.` }).catch(() => {});
  const heldDeposits = await db.select({
    id: transactionsTable.id,
    amount: transactionsTable.amount,
    reference: transactionsTable.reference,
  }).from(transactionsTable).where(and(
    eq(transactionsTable.userId, row.userId),
    eq(transactionsTable.type, "fund"),
    eq(transactionsTable.status, "pending"),
    eq(transactionsTable.isFlagged, true),
  ));
  if (heldDeposits.length > 0) {
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isAdmin, true));
    const heldSummary = heldDeposits.map((deposit) => `₦${parseFloat(deposit.amount).toLocaleString()} (${deposit.reference})`).join(", ");
    await Promise.allSettled(admins.map((admin) => notifyUser({
      userId: admin.id,
      type: "admin",
      title: "KYC approved — deposit release needed",
      body: `A customer completed KYC. Review and release ${heldSummary}.`,
      link: `/transactions`,
    })));
    try {
      await sendAdminAlertEmail(
        "KYC approved — held deposit needs release",
        `KYC was approved for user #${row.userId}. Held deposits awaiting admin release: ${heldSummary}`,
      );
    } catch (e: any) {
      req.log?.warn?.({ err: e?.message, userId: row.userId }, "admin alert email of held deposit release failed");
    }
  }
  res.json({ success: true });
});

router.post("/admin/kyc/:id/reject", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const reason = String(req.body?.reason ?? "Submission did not meet verification standards.").trim();
  const [row] = await db.select().from(kycTable).where(eq(kycTable.id, id));
  if (!row) { res.status(404).json({ error: "KYC record not found" }); return; }
  if (row.status !== "submitted") { res.status(409).json({ error: `Cannot reject a submission in '${row.status}' state. Refresh the queue.` }); return; }
  const updated = await db.update(kycTable)
    .set({ status: "rejected", rejectionReason: reason, reviewedBy: req.admin?.id ?? null })
    .where(and(eq(kycTable.id, id), eq(kycTable.status, "submitted")))
    .returning({ id: kycTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "Submission state changed — refresh and try again." }); return; }
  await notifyUser({ userId: row.userId, type: "warning", title: "KYC needs attention", body: `Your verification was not approved: ${reason}. You can resubmit anytime.` }).catch(() => {});
  res.json({ success: true });
});

// ── SMS ──────────────────────────────────────────────────────────────────────
router.get("/admin/sms-activations", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({ s: smsActivationsTable, userEmail: usersTable.email })
    .from(smsActivationsTable)
    .leftJoin(usersTable, eq(usersTable.id, smsActivationsTable.userId))
    .orderBy(desc(smsActivationsTable.createdAt))
    .limit(200);
  res.json({ data: rows.map(r => ({ ...r.s, amount: parseFloat(r.s.amount), userEmail: r.userEmail, createdAt: r.s.createdAt.toISOString() })) });
});

// ── SUPPORT CHAT (admin side) ────────────────────────────────────────────────
// List chats. Default to non-closed. Optional ?status=waiting|live|ai|closed|all
router.get("/admin/support/chats", requireAdmin, async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "open");
  let whereExpr;
  if (status === "all") whereExpr = undefined;
  else if (status === "open") whereExpr = ne(supportChatsTable.status, "closed");
  else whereExpr = eq(supportChatsTable.status, status);
  const rows = await db.select({
    id: supportChatsTable.id, userId: supportChatsTable.userId, status: supportChatsTable.status,
    assignedAdminId: supportChatsTable.assignedAdminId, unreadForAdmin: supportChatsTable.unreadForAdmin,
     lastMessageAt: supportChatsTable.lastMessageAt, createdAt: supportChatsTable.createdAt,
     rating: supportChatsTable.rating,
    userEmail: usersTable.email, userFirstName: usersTable.firstName, userLastName: usersTable.lastName,
    userPhone: usersTable.phone, userKycLevel: usersTable.kycLevel,
  }).from(supportChatsTable)
    .leftJoin(usersTable, eq(usersTable.id, supportChatsTable.userId))
    .where(whereExpr as any)
    .orderBy(
      // waiting first, then live, then ai, then by most recent
      sql`CASE ${supportChatsTable.status} WHEN 'waiting' THEN 0 WHEN 'live' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END`,
      desc(supportChatsTable.lastMessageAt),
    ).limit(200);
  res.json({ data: rows });
});

// Open a chat with its messages (admin view)
router.get("/admin/support/chats/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  const [u] = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone, kycLevel: usersTable.kycLevel, isVerified: usersTable.isVerified, isSuspended: usersTable.isSuspended })
    .from(usersTable).where(eq(usersTable.id, chat.userId));
  const messages = await db.select().from(supportMessagesTable).where(eq(supportMessagesTable.chatId, id)).orderBy(supportMessagesTable.id);
  // Clear admin-side unread counter on open
  if (chat.unreadForAdmin > 0) {
    await db.update(supportChatsTable).set({ unreadForAdmin: 0 }).where(eq(supportChatsTable.id, id));
    chat.unreadForAdmin = 0;
  }
  res.json({ chat, user: u, messages });
});

// Poll for new messages (admin)
router.get("/admin/support/chats/:id/poll", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const since = parseInt(String(req.query.since ?? "0"), 10) || 0;
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  const messages = await db.select().from(supportMessagesTable)
    .where(and(eq(supportMessagesTable.chatId, id), gt(supportMessagesTable.id, since)))
    .orderBy(supportMessagesTable.id);
  if (chat.unreadForAdmin > 0) {
    await db.update(supportChatsTable).set({ unreadForAdmin: 0 }).where(eq(supportChatsTable.id, id));
    chat.unreadForAdmin = 0;
  }
  res.json({ chat, messages });
});

// Admin joins as the live "Support" agent (never surfaces as "Admin" to the user)
router.post("/admin/support/chats/:id/join", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "closed") { res.status(409).json({ error: "Chat is closed" }); return; }
  // Conditional flip: only insert the system banner if THIS call actually
  // transitioned the chat to live. Two admins clicking Join simultaneously
  // will only produce one "Support has joined" message.
  const promoted = await db.update(supportChatsTable)
    .set({
      status: "live", assignedAdminId: req.admin?.id ?? null,
      updatedAt: new Date(), lastMessageAt: new Date(),
      unreadForUser: sql`${supportChatsTable.unreadForUser} + 1`,
    })
    .where(and(eq(supportChatsTable.id, id), ne(supportChatsTable.status, "live"), ne(supportChatsTable.status, "closed")))
    .returning({ id: supportChatsTable.id });
  if (promoted.length > 0) {
    await db.insert(supportMessagesTable).values({
      chatId: id, sender: "system", body: "Support has joined the chat 🎧 — how can we help?",
    });
  }
  res.json({ success: true, joined: promoted.length > 0 });
});

// Agent sends a message — appears to user as "Support"
router.post("/admin/support/chats/:id/message", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const body = String((req.body ?? {}).body ?? "").trim();
  const imageUrl = String((req.body ?? {}).imageUrl ?? "").trim() || null;
  if (!body && !imageUrl) { res.status(400).json({ error: "Message cannot be empty" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "Message too long" }); return; }
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "closed") { res.status(409).json({ error: "Chat is closed" }); return; }
  // Auto-promote to live if this admin's reply is the trigger. Conditional
  // update ensures only one "Support has joined" banner gets inserted even
  // when multiple admins type concurrently.
  const autoPromoted = await db.update(supportChatsTable)
    .set({ status: "live", assignedAdminId: req.admin?.id ?? null })
    .where(and(eq(supportChatsTable.id, id), ne(supportChatsTable.status, "live"), ne(supportChatsTable.status, "closed")))
    .returning({ id: supportChatsTable.id });
  if (autoPromoted.length > 0) {
    await db.insert(supportMessagesTable).values({ chatId: id, sender: "system", body: "Support has joined the chat 🎧" });
  }
  const [msg] = await db.insert(supportMessagesTable).values({ chatId: id, sender: "agent", body: body || "📷 Image", imageUrl }).returning();
  await db.update(supportChatsTable)
    .set({ lastMessageAt: new Date(), updatedAt: new Date(), unreadForUser: sql`${supportChatsTable.unreadForUser} + 1` })
    .where(eq(supportChatsTable.id, id));
  res.json({ message: msg });
});

// Admin image attachments use the same server-relative support storage as user
// attachments, so historical messages remain renderable after a chat closes.
router.post("/admin/support/chats/:id/upload-image", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "closed") { res.status(409).json({ error: "Chat is closed" }); return; }
  const imageData = String((req.body ?? {}).imageData ?? "");
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!match) { res.status(400).json({ error: "Invalid image data" }); return; }
  const b64 = match[2];
  if (b64.length > 2_000_000) { res.status(413).json({ error: "Image too large (max ~1.5 MB)" }); return; }
  const ext = match[1].split("/")[1].replace("jpeg", "jpg");
  const filename = `s${id}-${Date.now()}.${ext}`;
  const uploadDir = path.resolve(process.cwd(), "uploads", "support");
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), Buffer.from(b64, "base64"));
  res.json({ url: `/api/uploads/support/${filename}` });
});

// Admin typing ping
router.post("/admin/support/chats/:id/typing", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid chat id" }); return; }
  if (!_typingAgentThrottle.shouldWrite(id)) { res.json({ success: true, throttled: true }); return; }
  const updated = await db.update(supportChatsTable)
    .set({ agentTypingAt: new Date() })
    .where(eq(supportChatsTable.id, id))
    .returning({ id: supportChatsTable.id });
  if (updated.length === 0) { res.status(404).json({ error: "Chat not found" }); return; }
  res.json({ success: true });
});

// Close the chat — also emails the user a "your issue has been attended to" summary.
router.post("/admin/support/chats/:id/close", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat) { res.status(404).json({ error: "Chat not found" }); return; }
  await clearSupportChat(id);
  // Best-effort resolution email — never block the close response on email delivery.
  void (async () => {
    try {
      const [u] = await db.select({ email: usersTable.email, firstName: usersTable.firstName })
        .from(usersTable).where(eq(usersTable.id, chat.userId));
      if (!u?.email) return;
      const body = `Hi ${u.firstName ?? "there"},\n\nYour recent support request on CipherPay has been attended to and the chat is now closed. We hope your issue is fully resolved.\n\nIf you have any further questions, simply open the Support tab in the app and start a new conversation — we're here to help.\n\nThanks for choosing CipherPay 💜`;
      await sendUserNotificationEmail(u.email, "Your support request has been resolved", body);
    } catch (e: any) {
      req.log.warn({ err: e?.message, chatId: id }, "resolution email failed");
    }
  })();
  res.json({ success: true });
});

export default router;
