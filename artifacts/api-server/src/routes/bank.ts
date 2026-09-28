import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, savedAccountsTable } from "@workspace/db";
import { ResolveAccountBody, SaveAccountBody } from "@workspace/api-zod";
import { listBanks, resolveAccount } from "../lib/flutterwave";

const router: IRouter = Router();

function getUserId(req: any): number | null {
  const rawId = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  return isNaN(id) ? null : id;
}

// In-memory cache for the bank list (the list is stable and changes rarely)
let bankCache: { data: Array<{ name: string; code: string; slug: string; logo: null }>; expires: number } | null = null;

router.get("/bank/list", async (_req, res): Promise<void> => {
  try {
    if (!bankCache || bankCache.expires < Date.now()) {
      const banks = await listBanks();
      const formatted = banks
        .map((b) => ({ name: b.name, code: b.code, slug: b.slug, logo: null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      bankCache = { data: formatted, expires: Date.now() + 60 * 60 * 1000 };
    }
    res.json({ data: bankCache.data });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Could not load banks" });
  }
});

router.post("/bank/resolve", async (req, res): Promise<void> => {
  const parsed = ResolveAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { accountNumber, bankCode } = parsed.data;
  try {
    const resolved = await resolveAccount(accountNumber, bankCode);
    res.json({
      accountName: resolved.account_name,
      accountNumber: resolved.account_number,
      bankCode,
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Could not verify account" });
  }
});

router.get("/bank/saved-accounts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const accounts = await db.select().from(savedAccountsTable).where(eq(savedAccountsTable.userId, userId));
  res.json(accounts.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.post("/bank/saved-accounts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = SaveAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const [account] = await db.insert(savedAccountsTable).values({ userId, ...parsed.data }).returning();
  res.status(201).json({ ...account, createdAt: account.createdAt.toISOString() });
});

router.delete("/bank/saved-accounts/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(savedAccountsTable).where(and(eq(savedAccountsTable.id, id), eq(savedAccountsTable.userId, userId)));
  res.sendStatus(204);
});

export default router;
