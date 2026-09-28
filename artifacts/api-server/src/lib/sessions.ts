import { db, sessionsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";

export async function createSession(
  userId: number,
  deviceName: string,
  platform: string,
  ipAddress?: string | null,
): Promise<number> {
  const [s] = await db
    .insert(sessionsTable)
    .values({ userId, deviceName, platform, ipAddress: ipAddress ?? null })
    .returning({ id: sessionsTable.id });
  return s.id;
}

export async function isSessionActive(sessionId: number): Promise<boolean> {
  const [s] = await db
    .select({ revoked: sessionsTable.revoked })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  return !!s && !s.revoked;
}

export async function touchSession(sessionId: number): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));
}

export async function listSessions(userId: number) {
  return db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.revoked, false)))
    .orderBy(desc(sessionsTable.lastActiveAt));
}

export async function revokeSession(userId: number, sessionId: number): Promise<boolean> {
  const r = await db
    .update(sessionsTable)
    .set({ revoked: true })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
    .returning({ id: sessionsTable.id });
  return r.length > 0;
}

export async function revokeAllExcept(userId: number, keepSessionId: number | null): Promise<void> {
  const conds = [eq(sessionsTable.userId, userId), eq(sessionsTable.revoked, false)];
  if (keepSessionId !== null) conds.push(ne(sessionsTable.id, keepSessionId));
  await db.update(sessionsTable).set({ revoked: true }).where(and(...conds));
}
