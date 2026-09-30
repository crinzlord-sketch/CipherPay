import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

function getUserId(req: any): number | null {
  const rawId = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  return isNaN(id) ? null : id;
}

// Look up a CipherPay user by email so senders can confirm the recipient before transfer.
router.get("/users/lookup-email", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }

  const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!u) { res.status(404).json({ error: "No CipherPay account found with that email" }); return; }

  res.json({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl ?? null,
    gender: u.gender ?? null,
    isSelf: u.id === userId,
  });
});

// Look up a CipherPay user by their account number so the sender can confirm
// who they're paying before a P2P transfer. Returns only safe public fields.
router.get("/users/lookup", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const accountNumber = String(req.query.accountNumber ?? "").trim();
  if (!/^\d{10}$/.test(accountNumber)) {
    res.status(400).json({ error: "Enter a valid 10-digit account number" });
    return;
  }

  const [u] = await db.select().from(usersTable).where(eq(usersTable.accountNumber, accountNumber));
  if (!u) { res.status(404).json({ error: "No CipherPay account found with that number" }); return; }

  res.json({
    accountNumber: u.accountNumber,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl ?? null,
    isSelf: u.id === userId,
  });
});

export default router;
