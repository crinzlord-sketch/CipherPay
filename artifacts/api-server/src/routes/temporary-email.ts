import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, temporaryInboxesTable } from "@workspace/db";
import { createProviderInbox, renewDueTemporaryInboxes } from "../lib/temporary-email";

function userId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function dto(row: typeof temporaryInboxesTable.$inferSelect) {
  return {
    id: row.id,
    address: row.address,
    inboxId: row.inboxId,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status === "active" && row.expiresAt.getTime() > Date.now() ? "active" : "unavailable",
    createdAt: row.createdAt.toISOString(),
  };
}

const router: IRouter = Router();

router.get("/temporary-email/inboxes", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Renewal is handled by the background sweep. Do not make the inbox page
  // depend on a provider/network call before it can render existing inboxes.
  void renewDueTemporaryInboxes().catch((error: any) => {
    req.log?.warn?.({ err: error?.message }, "temporary inbox background renewal failed");
  });
  const rows = await db.select().from(temporaryInboxesTable)
    .where(eq(temporaryInboxesTable.userId, id))
    .orderBy(asc(temporaryInboxesTable.slot));
  res.json({ data: rows.map(dto) });
});

router.post("/temporary-email/inboxes", async (req, res): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
  const existing = await db.select().from(temporaryInboxesTable)
    .where(eq(temporaryInboxesTable.userId, id))
    .orderBy(asc(temporaryInboxesTable.slot));
  if (existing.length >= 2) { res.status(409).json({ error: "You can keep up to two temporary inboxes." }); return; }
  const slot = existing.some((row) => row.slot === 1) ? 2 : 1;
  try {
    const created = await createProviderInbox();
    const [row] = await db.insert(temporaryInboxesTable).values({
      userId: id,
      slot,
      address: created.address,
      inboxId: created.inboxId,
      expiresAt: created.expiresAt,
      status: "active",
    }).returning();
    res.status(201).json(dto(row));
  } catch (error: any) {
    req.log?.warn?.({ err: error?.message }, "temporary inbox creation failed");
    res.status(502).json({ error: "Temporary email is unavailable right now. Please try again." });
  }
});

router.delete("/temporary-email/inboxes/:id", async (req, res): Promise<void> => {
  const ownerId = userId(req);
  const inboxId = parseInt(String(req.params.id), 10);
  if (!ownerId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!Number.isFinite(inboxId)) { res.status(400).json({ error: "Invalid inbox." }); return; }
  const [deleted] = await db.delete(temporaryInboxesTable)
    .where(and(eq(temporaryInboxesTable.id, inboxId), eq(temporaryInboxesTable.userId, ownerId)))
    .returning({ id: temporaryInboxesTable.id });
  if (!deleted) { res.status(404).json({ error: "Inbox not found." }); return; }
  res.json({ success: true });
});

export default router;