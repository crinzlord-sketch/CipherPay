import jwt from "jsonwebtoken";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for token signing. Refusing to start with insecure default.");
}
const SECRET: string = process.env.SESSION_SECRET;

export function signToken(userId: number, sid?: number): string {
  const payload: { userId: number; sid?: number } = { userId };
  if (sid !== undefined) payload.sid = sid;
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number; sid?: number } | null {
  try {
    return jwt.verify(token, SECRET) as unknown as { userId: number; sid?: number };
  } catch {
    return null;
  }
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "CB";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateReference(prefix: string = "TXN"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}
