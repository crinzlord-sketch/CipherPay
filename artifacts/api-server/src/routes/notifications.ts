import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

function normalizeLink(link: string | null): string | null {
  return link && /^\/transactions\/\d+$/.test(link) ? "/transactions" : link;
}

function uid(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return isNaN(id) ? null : id;
}

router.get("/notifications", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const [rows, [{ unread }]] = await Promise.all([
    db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt)).limit(limit),
    db.select({ unread: sql<number>`count(*)::int` }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false))),
  ]);
  res.json({
    data: rows.map(r => ({ ...r, link: normalizeLink(r.link), createdAt: r.createdAt.toISOString() })),
    unread: Number(unread ?? 0),
  });
});

router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ unread: Number(unread ?? 0) });
});

// Store the user's Expo push token so the server can send locked-screen push
// notifications when wallet events happen (withdrawal sent, funded, etc.).
router.post("/notifications/push-token", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token.startsWith("ExponentPushToken[")) {
    res.status(400).json({ error: "Invalid push token" }); return;
  }
  await db.update(usersTable).set({ expoPushToken: token }).where(eq(usersTable.id, userId));
  res.json({ success: true });
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ success: true });
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ success: true });
});

router.delete("/notifications", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
  res.json({ success: true });
});

router.delete("/notifications/:id", async (req, res): Promise<void> => {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ success: true });
});

export default router;
