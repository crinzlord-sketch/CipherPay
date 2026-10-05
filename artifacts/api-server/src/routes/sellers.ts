import { Router, type IRouter } from "express";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { sql, eq, desc } from "drizzle-orm";
import { db, kycTable, usersTable, notificationsTable, transactionsTable } from "@workspace/db";
import { requireAdmin } from "../lib/admin-auth";
import { notifyUser } from "../lib/notifications";
import { sendAdminAlertEmail, sendUserNotificationEmail } from "../lib/email";
import { generateReference } from "../lib/auth";

const router: IRouter = Router();
const platforms = new Set(["instagram","tiktok","facebook","discord","twitter","youtube","telegram","snapchat","linkedin"]);
const SELLER_FEE_RATE = 5;

const uid = (req: any) => {
  const n = Number(req.headers["x-user-id"]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function requestIp(req: any): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || String(req.headers["x-real-ip"] ?? req.socket?.remoteAddress ?? "").trim().slice(0, 100);
}

const key = () => createHash("sha256").update(process.env.SOCIAL_ACCOUNT_ENCRYPTION_KEY || process.env.SESSION_SECRET || "").digest();
const enc = (v: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const d = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return iv.toString("base64url") + "." + c.getAuthTag().toString("base64url") + "." + d.toString("base64url");
};

let tablesPromise: Promise<void> | null = null;
async function tables() {
  if (tablesPromise) return tablesPromise;
  tablesPromise = (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS seller_applications(
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      legal_name text NOT NULL,
      seller_name text NOT NULL,
      phone text NOT NULL,
      address text NOT NULL,
      country text NOT NULL,
      account_source text NOT NULL,
      experience text,
      data_consent boolean NOT NULL DEFAULT false,
      fraud_prevention_consent boolean NOT NULL DEFAULT false,
      application_ip text,
      user_agent text,
      status text NOT NULL DEFAULT 'submitted',
      admin_note text,
      reviewed_by integer,
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS seller_applications_status_idx ON seller_applications(status,created_at)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS seller_applications_user_pending_idx ON seller_applications(user_id) WHERE status IN ('submitted','reviewing','approved')`);
    await db.execute(sql`ALTER TABLE social_account_inventory ADD COLUMN IF NOT EXISTS seller_user_id integer`);
    await db.execute(sql`ALTER TABLE social_account_inventory ADD COLUMN IF NOT EXISTS seller_fee_rate numeric(5,2) NOT NULL DEFAULT 5.00`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS social_account_inventory_seller_idx ON social_account_inventory(seller_user_id,status)`);
  })().catch(error => { tablesPromise = null; throw error; });
  return tablesPromise;
}
void tables().catch(e => console.error("Seller tables setup failed", e));

async function approvedSeller(userId: number) {
  await tables();
  const r = await db.execute(sql`SELECT id,seller_name AS "sellerName",status FROM seller_applications WHERE user_id=${userId} AND status='approved' ORDER BY reviewed_at DESC NULLS LAST, id DESC LIMIT 1`);
  return r.rows[0] as any;
}

router.get("/sellers/status", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await tables();
  const [kyc] = await db.select({ status: kycTable.status, level: kycTable.level })
    .from(kycTable).where(eq(kycTable.userId, userId)).limit(1);
  const r = await db.execute(sql`SELECT id,legal_name AS "legalName",seller_name AS "sellerName",phone,address,country,account_source AS "accountSource",experience,status,admin_note AS "adminNote",created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM seller_applications WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`);
  const application: any = r.rows[0] ?? null;
  res.json({
    kycVerified: kyc?.status === "verified",
    kycLevel: Number(kyc?.level ?? 0),
    sellerFeeRate: SELLER_FEE_RATE,
    approved: application?.status === "approved",
    application,
  });
});

router.post("/sellers/apply", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await tables();

  const [user] = await db.select({
    id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, phone: usersTable.phone,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [kyc] = await db.select({
    status: kycTable.status, level: kycTable.level, fullName: kycTable.fullName, address: kycTable.address,
  }).from(kycTable).where(eq(kycTable.userId, userId)).limit(1);

  if (!user) { res.status(404).json({ error: "User account not found." }); return; }
  if (kyc?.status !== "verified") {
    res.status(403).json({ error: "Complete and pass KYC verification before applying to become a seller." });
    return;
  }

  const existing = await db.execute(sql`SELECT id,status FROM seller_applications WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`);
  const latest: any = existing.rows[0];
  if (latest?.status === "approved") { res.status(409).json({ error: "You are already an approved seller." }); return; }
  if (latest?.status === "submitted" || latest?.status === "reviewing") { res.status(409).json({ error: "Your seller application is already under review." }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const legalName = String(body.legalName ?? kyc.fullName ?? `${user.firstName} ${user.lastName}`).trim().slice(0, 160);
  const sellerName = String(body.sellerName ?? "").trim().slice(0, 100);
  const phone = String(body.phone ?? user.phone ?? "").trim().slice(0, 40);
  const address = String(body.address ?? kyc.address ?? "").trim().slice(0, 500);
  const country = String(body.country ?? "").trim().slice(0, 80);
  const accountSource = String(body.accountSource ?? "").trim().slice(0, 1000);
  const experience = String(body.experience ?? "").trim().slice(0, 2000);
  const dataConsent = body.dataConsent === true;
  const fraudConsent = body.fraudPreventionConsent === true;

  if (!legalName || !sellerName || !phone || !address || !country || !accountSource) {
    res.status(400).json({ error: "Please complete all required seller details." }); return;
  }
  if (!dataConsent || !fraudConsent) {
    res.status(400).json({ error: "You must acknowledge the seller data and fraud-prevention terms." }); return;
  }

  const ip = requestIp(req);
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 500);

  const inserted = await db.execute(sql`INSERT INTO seller_applications
    (user_id,legal_name,seller_name,phone,address,country,account_source,experience,data_consent,fraud_prevention_consent,application_ip,user_agent)
    VALUES(${userId},${legalName},${sellerName},${phone},${address},${country},${accountSource},${experience || null},${dataConsent},${fraudConsent},${ip || null},${ua || null})
    RETURNING id,status,created_at AS "createdAt"`);
  const application: any = inserted.rows[0];

  await notifyUser({
    userId,
    type: "info",
    title: "Seller application received",
    body: "Your seller application has been submitted. We’ll review your verified identity and seller details before granting access.",
    link: "/social-accounts",
    email: true,
  }).catch(() => {});

  try {
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isAdmin, true));
    if (admins.length) {
      await db.insert(notificationsTable).values(admins.map(admin => ({
        userId: admin.id,
        type: "admin_seller",
        title: "New seller application",
        body: `${sellerName} (${user.email}) has applied to sell social accounts. Review the application in Admin → Sellers.`,
        link: "/admin?tab=sellers",
      })));
    }
    await sendAdminAlertEmail(
      "New seller application",
      `A verified CipherPay customer has applied to become a seller.\n\nSeller: ${sellerName}\nEmail: ${user.email}\nUser ID: #${userId}\nCountry: ${country}\nKYC: verified (level ${kyc.level ?? 0})\nApplication IP: ${ip || "not available"}\n\nReview the application in Admin → Sellers.`,
    );
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, "seller application admin alert failed");
  }

  res.status(201).json({ success: true, application });
});

router.get("/seller/dashboard", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const seller = await approvedSeller(userId);
  if (!seller) { res.status(403).json({ error: "Seller access has not been approved." }); return; }

  const listings = await db.execute(sql`SELECT id,platform,country,title,price,username,status,created_at AS "createdAt",purchased_at AS "purchasedAt" FROM social_account_inventory WHERE seller_user_id=${userId} ORDER BY created_at DESC LIMIT 300`);
  const sales = await db.execute(sql`SELECT o.id,o.platform,o.country,o.title,o.amount,o.reference,o.created_at AS "createdAt",i.seller_fee_rate AS "feeRate",ROUND(o.amount*(1-i.seller_fee_rate/100),2) AS "sellerNet" FROM social_account_orders o JOIN social_account_inventory i ON i.id=o.inventory_id WHERE i.seller_user_id=${userId} ORDER BY o.created_at DESC LIMIT 100`);
  const [available] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM social_account_inventory WHERE seller_user_id=${userId} AND status='available'`);
  const [sold] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM social_account_inventory WHERE seller_user_id=${userId} AND status='sold'`);
  res.json({ seller, feeRate: SELLER_FEE_RATE, listings: listings.rows, sales: sales.rows, stats: { available: Number((available as any)?.rows?.[0]?.count ?? 0), sold: Number((sold as any)?.rows?.[0]?.count ?? 0) } });
});

router.post("/seller/listings", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const seller = await approvedSeller(userId);
  if (!seller) { res.status(403).json({ error: "Seller access has not been approved." }); return; }

  const body = (req.body ?? {}) as Record<string, any>;
  const p = String(body.platform ?? "").toLowerCase().trim();
  const c = String(body.country ?? "").trim();
  const t = String(body.title ?? "").trim().slice(0, 160);
  const price = Number(body.price);
  const details = body.details;
  const username = String(body.username ?? details?.username ?? "").trim().slice(0, 160);

  if (!platforms.has(p) || !c || !t || !Number.isFinite(price) || price <= 0 || price > 10000000 || !details || typeof details !== "object") {
    res.status(400).json({ error: "Platform, country, title, valid price and account credentials are required." }); return;
  }

  await tables();
  const r = await db.execute(sql`INSERT INTO social_account_inventory(platform,country,title,price,username,encrypted_details,seller_user_id,seller_fee_rate) VALUES(${p},${c.slice(0,100)},${t},${price.toFixed(2)},${username || null},${enc(JSON.stringify(details))},${userId},${SELLER_FEE_RATE}) RETURNING id,platform,country,title,price,username,status,created_at AS "createdAt"`);
  res.status(201).json({ item: r.rows[0], feeRate: SELLER_FEE_RATE });
});

router.delete("/seller/listings/:id", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const seller = await approvedSeller(userId);
  if (!seller) { res.status(403).json({ error: "Seller access has not been approved." }); return; }
  await tables();
  await db.execute(sql`DELETE FROM social_account_inventory WHERE id=${Number(req.params.id)} AND seller_user_id=${userId} AND status='available'`);
  res.json({ success: true });
});

router.get("/admin/seller-applications", requireAdmin, async (_req, res): Promise<void> => {
  await tables();
  const r = await db.execute(sql`SELECT a.id,a.user_id AS "userId",a.legal_name AS "legalName",a.seller_name AS "sellerName",a.phone,a.address,a.country,a.account_source AS "accountSource",a.experience,a.status,a.admin_note AS "adminNote",a.application_ip AS "applicationIp",a.user_agent AS "userAgent",a.created_at AS "createdAt",a.reviewed_at AS "reviewedAt",u.email,u.first_name AS "firstName",u.last_name AS "lastName",k.status AS "kycStatus",k.level AS "kycLevel",k.full_name AS "kycFullName",k.date_of_birth AS "kycDateOfBirth",k.address AS "kycAddress" FROM seller_applications a JOIN users u ON u.id=a.user_id LEFT JOIN kyc k ON k.user_id=a.user_id ORDER BY CASE WHEN a.status IN ('submitted','reviewing') THEN 0 ELSE 1 END,a.created_at DESC LIMIT 300`);
  res.json({ data: r.rows });
});

router.patch("/admin/seller-applications/:id", requireAdmin, async (req, res): Promise<void> => {
  await tables();
  const id = Number(req.params.id);
  const status = String(req.body?.status ?? "");
  if (!["approved","declined","reviewing"].includes(status)) { res.status(400).json({ error: "Invalid seller application status." }); return; }

  const [application] = (await db.execute(sql`SELECT a.*,u.email,u.first_name AS "firstName",u.last_name AS "lastName",k.status AS "kycStatus",k.level AS "kycLevel" FROM seller_applications a JOIN users u ON u.id=a.user_id LEFT JOIN kyc k ON k.user_id=a.user_id WHERE a.id=${id} LIMIT 1`)).rows as any[];
  if (!application) { res.status(404).json({ error: "Seller application not found." }); return; }

  if (status === "approved" && application.kycStatus !== "verified") {
    res.status(400).json({ error: "Seller cannot be approved until KYC is verified." }); return;
  }

  const note = String(req.body?.adminNote ?? "").trim().slice(0, 2000) || null;
  await db.execute(sql`UPDATE seller_applications SET status=${status},admin_note=${note},reviewed_by=${req.admin!.id},reviewed_at=now(),updated_at=now() WHERE id=${id}`);

  const title = status === "approved" ? "You’re approved to sell" : status === "declined" ? "Seller application update" : "Seller application is being reviewed";
  const body = status === "approved"
    ? `Your seller application has been approved. The Sellers section is now available in your CipherPay account. CipherPay keeps a ${SELLER_FEE_RATE}% platform share on each completed sale.`
    : status === "declined"
      ? `Your seller application was not approved at this time.${note ? ` Admin note: ${note}` : ""}`
      : "Your seller application is now being reviewed by the CipherPay team.";

  await notifyUser({ userId: application.user_id, type: status === "approved" ? "success" : status === "declined" ? "warning" : "info", title, body, link: status === "approved" ? "/seller" : "/social-accounts", email: true }).catch(() => {});

  res.json({ success: true, status, userEmail: application.email });
});

router.get("/admin/sellers", requireAdmin, async (_req, res): Promise<void> => {
  await tables();
  const r = await db.execute(sql`SELECT a.user_id AS "userId",u.email,a.seller_name AS "sellerName",a.country,a.reviewed_at AS "approvedAt",a.application_ip AS "applicationIp" FROM seller_applications a JOIN users u ON u.id=a.user_id WHERE a.status='approved' ORDER BY a.reviewed_at DESC NULLS LAST,a.id DESC`);
  res.json({ data: r.rows });
});

export default router;
