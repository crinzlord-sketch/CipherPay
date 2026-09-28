import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "./auth";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for admin token signing. Refusing to start with insecure default.");
}
const SECRET: string = process.env.SESSION_SECRET;

export interface AdminTokenPayload { userId: number; role: "admin" }

export function signAdminToken(userId: number): string {
  return jwt.sign({ userId, role: "admin" }, SECRET, { expiresIn: "7d" });
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as unknown as AdminTokenPayload;
    if (decoded.role !== "admin") return null;
    return decoded;
  } catch { return null; }
}

export interface AdminRequest extends Request {
  admin?: typeof usersTable.$inferSelect;
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing admin token" }); return; }

  const adminPayload = verifyAdminToken(token);
  const userPayload = adminPayload ? { userId: adminPayload.userId } : verifyToken(token);
  if (!userPayload) { res.status(401).json({ error: "Invalid or expired admin session" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userPayload.userId));
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Not an admin" }); return;
  }

  req.admin = user;
  next();
}
