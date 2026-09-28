import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import { db, adsTable } from "@workspace/db";
import { requireAdmin, type AdminRequest } from "../lib/admin-auth";
import path from "path";
import fs from "fs/promises";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "ads");
const PUBLIC_BASE = "/api/uploads/ads";

async function saveAdImage(adminId: number, dataUrl: string): Promise<string | null> {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = (m[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const buf = Buffer.from(m[2] ?? "", "base64");
  if (!buf.length || buf.length > 8 * 1024 * 1024) return null; // 8MB cap
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `a${adminId}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);
  return `${PUBLIC_BASE}/${filename}`;
}

const router: IRouter = Router();

// ── USER: active offers/ads ────────────────────────────────────────────────
router.get("/ads", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ id: adsTable.id, title: adsTable.title, description: adsTable.description, imageUrl: adsTable.imageUrl, link: adsTable.link })
    .from(adsTable)
    .where(eq(adsTable.active, true))
    .orderBy(asc(adsTable.sortOrder), desc(adsTable.createdAt));
  res.json({ items: rows });
});

// ── ADMIN: manage ads ──────────────────────────────────────────────────────
router.get("/admin/ads", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(adsTable).orderBy(asc(adsTable.sortOrder), desc(adsTable.createdAt));
  res.json({ items: rows });
});

router.post("/admin/ads", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, any>;
  const image = String(body.image ?? "");
  const title = body.title ? String(body.title).trim().slice(0, 120) : null;
  const description = body.description ? String(body.description).trim().slice(0, 500) : null;
  const link = body.link ? String(body.link).trim().slice(0, 500) : null;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? parseInt(String(body.sortOrder), 10) : 0;

  if (!image) { res.status(400).json({ error: "Please attach an advert image." }); return; }

  let imageUrl: string | null;
  try {
    imageUrl = await saveAdImage(req.admin?.id ?? 0, image);
  } catch {
    res.status(400).json({ error: "Could not save the image. Try a smaller file (under 8MB)." }); return;
  }
  if (!imageUrl) { res.status(400).json({ error: "Invalid image. Use a JPG, PNG or WebP under 8MB." }); return; }

  const [row] = await db.insert(adsTable).values({ title, description, imageUrl, link, sortOrder, createdBy: req.admin?.id ?? null, active: true }).returning();
  res.json(row);
});

router.patch("/admin/ads/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = (req.body ?? {}) as Record<string, any>;
  const patch: Record<string, any> = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.title !== undefined) patch.title = body.title ? String(body.title).trim().slice(0, 120) : null;
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim().slice(0, 500) : null;
  if (body.link !== undefined) patch.link = body.link ? String(body.link).trim().slice(0, 500) : null;
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) patch.sortOrder = parseInt(String(body.sortOrder), 10);
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(adsTable).set(patch).where(eq(adsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Ad not found" }); return; }
  res.json(row);
});

router.delete("/admin/ads/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(adsTable).where(eq(adsTable.id, id)).returning({ id: adsTable.id });
  if (!row) { res.status(404).json({ error: "Ad not found" }); return; }
  res.json({ success: true });
});

export default router;
