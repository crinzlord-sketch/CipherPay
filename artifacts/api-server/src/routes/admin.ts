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
  sessionsTable,
} from "@workspace/db";
import { gt, ne } from "drizzle-orm";
import { signAdminToken, requireAdmin, type AdminRequest } from "../lib/admin-auth";
import { creditWallet, debitWallet, formatTransaction } from "../lib/wallet";
import { generateReference, generateReferralCode } from "../lib/auth";
import { notifyUser } from "../lib/notifications";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "../lib/email";
import { _typingAgentThrottle, clearSupportChat } from "./support";
import { SERVICE_FEATURES, getServiceFeatureStatus, setServiceFeatureStatus } from "../lib/service-features";

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

// Unread admin alerts power the small badges shown on individual console tabs.
// Alerts are stored in the existing notifications table, scoped to the admin.
router.get("/admin/alerts", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const adminId = req.admin!.id;
  const [kyc, support, seller] = await Promise.all([
    db.select({ c: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, adminId), eq(notificationsTable.type, "admin_kyc"), eq(notificationsTable.isRead, false))),
    db.select({ c: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, adminId), eq(notificationsTable.type, "admin_support"), eq(notificationsTable.isRead, false))),
    db.select({ c: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, adminId), eq(notificationsTable.type, "admin_seller"), eq(notificationsTable.isRead, false))),
  ]);
  res.json({
    verification: Number(kyc[0]?.c ?? 0),
    support: Number(support[0]?.c ?? 0),
    sellers: Number(seller[0]?.c ?? 0),
  });
});

router.post("/admin/alerts/read", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const type = String(req.body?.type ?? "").trim();
  if (!["admin_kyc", "admin_support", "admin_seller"].includes(type)) {
    res.status(400).json({ error: "Invalid admin alert type." });
    return;
  }
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(
      eq(notificationsTable.userId, req.admin!.id),
      eq(notificationsTable.type, type),
      eq(notificationsTable.isRead, false),
    ));
  res.json({ success: true });
});

router.get("/admin/service-features", requireAdmin, async (_req: AdminRequest, res): Promise<void> => {