import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, kycTable, usersTable, notificationsTable } from "@workspace/db";
import { notifyUser } from "../lib/notifications";
import { sendAdminAlertEmail } from "../lib/email";
import path from "path";
import fs from "fs/promises";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "kyc");
const PUBLIC_BASE = "/api/uploads/kyc";

const VALID_DOC_TYPES = ["bvn", "nin", "passport", "drivers_license", "national_id", "voters_card"] as const;
type DocType = typeof VALID_DOC_TYPES[number];

function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  const n = id ? parseInt(id, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function formatKyc(k: typeof kycTable.$inferSelect | undefined, fallbackLevel: number) {
  if (!k) return { status: "not_started", level: fallbackLevel, verificationType: null, documentType: null, submittedAt: null, verifiedAt: null, rejectionReason: null, documentFrontUrl: null, documentBackUrl: null, selfieUrl: null, fullName: null, dateOfBirth: null, address: null };
  return {
    status: k.status, level: k.level,
    verificationType: k.documentType === "bvn" || k.documentType === "nin" ? "basic" : k.documentType ? "advanced" : null,
    documentType: k.documentType,
    documentNumber: k.documentNumber, bvn: k.bvn, nin: k.nin,
    submittedAt: k.submittedAt ? k.submittedAt.toISOString() : null,
    verifiedAt: k.verifiedAt ? k.verifiedAt.toISOString() : null,
    rejectionReason: k.rejectionReason,
    documentFrontUrl: k.documentFrontUrl,
    documentBackUrl: k.documentBackUrl,
    selfieUrl: k.selfieUrl,
    fullName: k.fullName, dateOfBirth: k.dateOfBirth, address: k.address,
  };
}

async function saveDataUrl(userId: number, label: string, dataUrl: string): Promise<string | null> {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = (m[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const buf = Buffer.from(m[2] ?? "", "base64");
  if (!buf.length || buf.length > 6 * 1024 * 1024) return null; // 6MB cap
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `u${userId}-${label}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);
  return `${PUBLIC_BASE}/${filename}`;
}

const router: IRouter = Router();

router.get("/kyc/status", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [kyc] = await db.select().from(kycTable).where(eq(kycTable.userId, userId));
  res.json(formatKyc(kyc, user?.kycLevel ?? 0));
});

router.post("/kyc/submit", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = (req.body ?? {}) as Record<string, any>;
  const verificationType = "basic" as const;
  const documentType = "nin" as DocType;
  if (!VALID_DOC_TYPES.includes(documentType)) {
    res.status(400).json({ error: "Please choose a document type." }); return;
  }
  const documentNumber: string = String(body.documentNumber ?? body.nin ?? "").trim();
  const fullName: string = String(body.fullName ?? "").trim();
  const dateOfBirth: string = String(body.dateOfBirth ?? "").trim();
  const address: string = String(body.address ?? "").trim();
  if (!/^\d{11}$/.test(documentNumber)) { res.status(400).json({ error: "NIN must contain 11 digits." }); return; }
  if (!fullName || fullName.split(/\s+/).length < 2) { res.status(400).json({ error: "Please enter your full legal name." }); return; }
  if (!dateOfBirth) { res.status(400).json({ error: "Date of birth is required." }); return; }
  if (address.length < 8) { res.status(400).json({ error: "Please enter your residential address." }); return; }

  const [existing] = await db.select().from(kycTable).where(eq(kycTable.userId, userId));
  if (existing?.status === "verified") { res.status(400).json({ error: "Your KYC is already verified." }); return; }
  if (existing?.status === "submitted") { res.status(400).json({ error: "Your previous submission is still under review." }); return; }

  const frontUrl: string | null = null;
  const backUrl: string | null = null;
  const selfieUrl: string | null = null;

  const now = new Date();
  const values = {
    status: "submitted" as const,
    level: verificationType === "basic" ? 1 : 2,
    documentType,
    documentNumber: documentType !== "bvn" && documentType !== "nin" ? documentNumber : null,
    bvn: documentType === "bvn" ? documentNumber : null,
    nin: documentType === "nin" ? documentNumber : null,
    documentFrontUrl: frontUrl,
    documentBackUrl: backUrl,
    selfieUrl,
    fullName,
    dateOfBirth: dateOfBirth || null,
    address: address || null,
    rejectionReason: null,
    submittedAt: now,
  };

  let row;
  if (existing) {
    [row] = await db.update(kycTable).set(values).where(eq(kycTable.userId, userId)).returning();
  } else {
    [row] = await db.insert(kycTable).values({ userId, ...values }).returning();
  }

  await notifyUser({ userId, type: "info", title: "KYC documents received", body: "Your verification is under review. We'll notify you within 24–48 hours." }).catch(() => {});

  // Create an unread admin alert for every admin. This powers the Verification
  // tab badge and remains independent of email delivery.
  try {
    const admins = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isAdmin, true));
    if (admins.length) {
      await db.insert(notificationsTable).values(admins.map((admin) => ({
        userId: admin.id,
        type: "admin_kyc",
        title: "New KYC submission",
        body: `${fullName || "A customer"} submitted ${documentType.toUpperCase()} verification. Review it in Admin → Verification.`,
        link: "/admin?tab=verification",
      })));
    }
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, "admin in-app KYC alert failed");
  }

  // Best-effort alert to the operator inbox — never block the user's request.
  try {
    const [submitter] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const userName = submitter ? `${submitter.firstName} ${submitter.lastName}` : fullName || `User #${userId}`;
    await sendAdminAlertEmail(
      "KYC submission awaiting review",
      `A user has submitted KYC documents for verification.\n\n` +
        `User: ${userName} (#${userId})\n` +
        `Email: ${submitter?.email ?? "unknown"}\n` +
        `Document type: ${documentType.toUpperCase()}\n` +
        `Full name on document: ${fullName}\n` +
        (dateOfBirth ? `Date of birth: ${dateOfBirth}\n` : "") +
        `\nReview in Admin → KYC.`,
    );
  } catch (e: any) {
    req.log?.warn?.({ err: e?.message }, "admin alert email of KYC submission failed");
  }

  res.json(formatKyc(row, 0));
});

export default router;
