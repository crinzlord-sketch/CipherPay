import { and, eq, gte } from "drizzle-orm";
import { db, userEmailEventsTable, usersTable } from "@workspace/db";
import { sendWeeklyEmail } from "./email";
import { logger } from "./logger";

const WEEKLY_MESSAGES = [
  ["A small CipherPay tip", "Your wallet is easier to manage when you keep an eye on your recent transactions. A quick review now and then can help you spot anything unexpected early."],
  ["Keep your account protected", "Use a strong password, keep your email secure, and never share an OTP or sign-in code. Small habits make a big difference."],
  ["Make CipherPay work for you", "Take a look around your account this week. Funding, transfers, bills and other services are all in one place when you need them."],
  ["A little weekly reset", "Check your balance, glance through your recent activity, and make sure your profile details are still up to date. A minute now can save time later."],
  ["You’re all set", "There’s no need to use everything at once. Explore at your own pace and keep the tools you actually need close at hand."],
];

function weekKey(date: Date): string {
  const start = new Date(date);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start.toISOString().slice(0, 10);
}

export async function sendWeeklyUserEmails(): Promise<void> {
  const now = new Date();
  const key = `weekly:${weekKey(now)}`;
  const rows = await db.select({
    id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName,
  }).from(usersTable).where(eq(usersTable.isVerified, true));
  const recent = new Set((await db.select({ userId: userEmailEventsTable.userId })
    .from(userEmailEventsTable).where(and(eq(userEmailEventsTable.kind, key), gte(userEmailEventsTable.sentAt, new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000))))).map(r => r.userId));
  const [title, body] = WEEKLY_MESSAGES[Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % WEEKLY_MESSAGES.length];
  for (const user of rows) {
    if (recent.has(user.id)) continue;
    try {
      await sendWeeklyEmail(user.email, user.firstName, title, body);
      await db.insert(userEmailEventsTable).values({ userId: user.id, kind: key, subject: title }).onConflictDoNothing();
    } catch (e: any) {
      logger.warn({ userId: user.id, err: e?.message }, "weekly user email failed");
    }
  }
}
