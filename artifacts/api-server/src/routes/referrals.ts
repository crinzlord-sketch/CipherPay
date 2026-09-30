import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, transactionsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();
const REFERRAL_BONUS_REFERRER = 200;
const REFERRAL_BONUS_REFEREE = 200;
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL ?? "https://cipherpay-web.onrender.com").replace(/\/$/, "");

function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}

router.get("/referrals", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select({
    id: usersTable.id,
    referralCode: usersTable.referralCode,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const referredUsers = await db.select({
    id: usersTable.id,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    isVerified: usersTable.isVerified,
    createdAt: usersTable.createdAt,
  }).from(usersTable)
    .where(eq(usersTable.referredBy, user.referralCode))
    .orderBy(desc(usersTable.createdAt));

  const rewards = await db.select({
    amount: transactionsTable.amount,
    description: transactionsTable.description,
    createdAt: transactionsTable.createdAt,
  }).from(transactionsTable)
    .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "referral")))
    .orderBy(desc(transactionsTable.createdAt));

  const totalEarned = rewards.reduce((sum, reward) => sum + Number(reward.amount ?? 0), 0);
  const successful = referredUsers.filter((person) => person.isVerified).length;
  const pending = referredUsers.length - successful;

  res.json({
    referralCode: user.referralCode,
    referralLink: `${PUBLIC_WEB_URL}/register?ref=${encodeURIComponent(user.referralCode)}`,
    rewardPerReferral: REFERRAL_BONUS_REFERRER,
    friendReward: REFERRAL_BONUS_REFEREE,
    totalEarned,
    successful,
    pending,
    referrals: referredUsers.map((person) => ({
      id: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      status: person.isVerified ? "rewarded" : "pending",
      createdAt: person.createdAt.toISOString(),
    })),
  });
});

export default router;
