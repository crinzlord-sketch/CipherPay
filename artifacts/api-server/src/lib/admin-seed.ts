import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { generateReferralCode } from "./auth";

/**
 * Idempotent admin bootstrap. Reads ADMIN_EMAIL and ADMIN_PASSWORD from env
 * and ensures a user with those credentials exists and has isAdmin=true.
 * - If the user exists but isn't admin → promotes them.
 * - If ADMIN_PASSWORD is set, the password is reset to that value on every boot
 *   (use ADMIN_PASSWORD_LOCK=1 to skip re-hashing after first run).
 */
export async function ensureAdminUser(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    logger.info("admin-seed skipped — set ADMIN_EMAIL and ADMIN_PASSWORD env to bootstrap an admin");
    return;
  }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    const hash = await bcrypt.hash(password, 10);
    if (existing) {
      const patch: Record<string, unknown> = { isAdmin: true, isSuspended: false };
      if (!process.env.ADMIN_PASSWORD_LOCK) patch.passwordHash = hash;
      await db.update(usersTable).set(patch).where(eq(usersTable.id, existing.id));
      logger.info({ email, id: existing.id }, "admin-seed: existing user promoted/refreshed");
    } else {
      const [created] = await db.insert(usersTable).values({
        email,
        passwordHash: hash,
        firstName: "CipherPay",
        lastName: "Admin",
        phone: "0000000000",
        isVerified: true,
        isAdmin: true,
        kycLevel: 2,
        referralCode: generateReferralCode(),
      }).returning();
      logger.info({ email, id: created.id }, "admin-seed: admin user created");
    }
  } catch (e: any) {
    logger.error({ err: e?.message }, "admin-seed failed");
  }
}
