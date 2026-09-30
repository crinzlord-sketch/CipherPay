import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, and, desc } from "drizzle-orm";
import { db, usersTable, otpTable, transactionsTable } from "@workspace/db";
import { RegisterBody, LoginBody, SendOtpBody, VerifyOtpBody, UpdateProfileBody, ChangePasswordBody } from "@workspace/api-zod";
import { signToken, generateOtp, generateReferralCode } from "../lib/auth";
import { signAdminToken } from "../lib/admin-auth";
import { generateUniqueAccountNumber } from "../lib/account";
import { createSession, listSessions, revokeSession, revokeAllExcept } from "../lib/sessions";
import { getOrCreateWallet, formatWallet, creditWallet } from "../lib/wallet";
import { ensureUserPayoutWallet } from "../lib/payout-wallet";
import { sendOtpEmail, isEmailConfigured, sendWelcomeEmail } from "../lib/email";
import { notifyUser } from "../lib/notifications";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

const AVATAR_DIR = path.resolve(process.cwd(), "uploads", "avatar");
const AVATAR_PUBLIC_BASE = "/api/uploads/avatar";
// Profile pics are intentionally publicly readable (we only persist the URL on the
// user row — no ACL story needed). Keep the size cap small.
async function saveAvatarDataUrl(userId: number, dataUrl: string): Promise<string> {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Image must be a JPG, PNG, or WebP data URL");
  const ext = (m[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const buf = Buffer.from(m[2] ?? "", "base64");
  if (!buf.length) throw new Error("Image is empty");
  if (buf.length > 4 * 1024 * 1024) throw new Error("Image too large (max 4MB)");
  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const filename = `u${userId}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(AVATAR_DIR, filename), buf);
  return `${AVATAR_PUBLIC_BASE}/${filename}`;
}

const router: IRouter = Router();
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
// Login OTP is controlled by the runtime flag so the second factor can be
// enabled without changing the auth contract or client bundle.
const LOGIN_OTP_ENABLED = true;
const otpCooldowns = new Map<string, number>();

function otpCooldownKey(target: string, purpose: string): string {
  return `${purpose}:${target.trim().toLowerCase()}`;
}

function markOtpIssued(target: string, purpose: string): void {
  otpCooldowns.set(otpCooldownKey(target, purpose), Date.now() + OTP_RESEND_COOLDOWN_MS);
}

function enforceOtpResendCooldown(target: string, purpose: string, res: any): boolean {
  const remainingMs = (otpCooldowns.get(otpCooldownKey(target, purpose)) ?? 0) - Date.now();
  if (remainingMs <= 0) return true;
  const retryAfterSeconds = Math.ceil(remainingMs / 1000);
  res.status(429).json({
    error: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
    retryAfterSeconds,
  });
  return false;
}

// Pull device metadata the mobile client sends so we can show a meaningful
// "logged-in devices" list. Falls back gracefully for older clients.
function getClientIp(req: any): string | null {
  const candidates = [
    req.headers["cf-connecting-ip"],
    req.headers["x-real-ip"],
    req.headers["x-forwarded-for"],
    req.headers["forwarded"],
    req.ip,
    req.socket?.remoteAddress,
  ];
  for (const candidate of candidates) {
    const raw = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof raw !== "string") continue;
    const first = raw.split(",")[0].trim().replace(/^for=/i, "").replace(/^"|"$/g, "");
    const cleaned = first.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
    if (cleaned && cleaned !== "::1" && cleaned !== "0.0.0.0") return cleaned;
  }
  return null;
}

function deviceInfo(req: any): { name: string; platform: string; ip: string | null } {
  const d = (req.body?.device ?? {}) as { name?: string; platform?: string };
  const ua = String(req.headers["user-agent"] ?? "").trim();
  const explicitName = typeof d.name === "string" ? d.name.trim() : "";
  const explicitPlatform = typeof d.platform === "string" ? d.platform.trim() : "";

  let platform = explicitPlatform;
  if (!platform) {
    if (/android/i.test(ua)) platform = "Android";
    else if (/iphone|ipad|ipod/i.test(ua)) platform = /ipad/i.test(ua) ? "iPadOS" : "iOS";
    else if (/windows/i.test(ua)) platform = "Windows";
    else if (/macintosh|mac os x/i.test(ua)) platform = "macOS";
    else if (/linux/i.test(ua)) platform = "Linux";
    else platform = "Unknown";
  }

  let deviceName = explicitName;
  if (!deviceName) {
    if (/iphone/i.test(ua)) deviceName = "iPhone";
    else if (/ipad/i.test(ua)) deviceName = "iPad";
    else if (/android/i.test(ua)) {
      const model = ua.match(/Android[^;)]*;\s*(?:[a-z]{2}(?:-[A-Z]{2})?;\s*)?(?:wv;\s*)?([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i)?.[1]?.trim();
      deviceName = model && model.length <= 80 ? model : "Android device";
    } else if (/windows/i.test(ua)) deviceName = "Windows PC";
    else if (/macintosh|mac os x/i.test(ua)) deviceName = "Mac";
    else if (/linux/i.test(ua)) deviceName = "Linux PC";
    else deviceName = "Web browser";
  }

  return {
    name: deviceName.slice(0, 80),
    platform: platform.slice(0, 40),
    ip: getClientIp(req),
  };
}

function getUserIdFromHeaders(req: any): number | null {
  const rawId = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  return isNaN(id) ? null : id;
}

function generateUserCode(): string {
  return `CP-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function formatUser(user: typeof usersTable.$inferSelect, balance?: number) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    avatarUrl: user.avatarUrl ?? null,
    gender: user.gender ?? null,
    accountNumber: user.accountNumber ?? null,
    walletBalance: balance ?? 0,
    isVerified: user.isVerified,
    kycLevel: user.kycLevel,
    referralCode: user.referralCode,
    userCode: user.userCode ?? null,
    chatPublicKey: user.chatPublicKey ?? null,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    return;
  }

  const { email, password, firstName, lastName, phone, referralCode } = parsed.data;
  const normalizedReferralCode = referralCode?.trim().toUpperCase() || undefined;
  const requestedGender = req.body?.gender === "male" || req.body?.gender === "female" ? req.body.gender : null;

  if (normalizedReferralCode) {
    const [referrer] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.referralCode, normalizedReferralCode)).limit(1);
    if (!referrer) {
      res.status(400).json({ error: "That referral code is not valid." });
      return;
    }
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const myReferralCode = generateReferralCode();
  let myUserCode = generateUserCode();
  while ((await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.userCode, myUserCode))).length) myUserCode = generateUserCode();
  const accountNumber = await generateUniqueAccountNumber();

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash,
    firstName,
    lastName,
    phone,
    accountNumber,
    referralCode: myReferralCode,
    userCode: myUserCode,
    referredBy: normalizedReferralCode ?? null,
    isVerified: false,
    kycLevel: 0,
  }).returning();

  // Do not block account creation on wallet provisioning. The wallet is created
  // immediately in the background, and the authenticated /api/wallet endpoint
  // also uses the same idempotent helper if the first attempt is delayed.
  if (requestedGender) {
    await db.update(usersTable).set({ gender: requestedGender }).where(eq(usersTable.id, user.id));
  }

  void getOrCreateWallet(user.id).catch((e: any) => {
    req.log?.warn?.({ userId: user.id, err: e?.message }, "initial CipherPay wallet provisioning failed");
  });

  // Provision the user's permanent Flutterwave payout wallet in the background.
  // Registration must still succeed if Flutterwave temporarily rejects or delays
  // PSA provisioning; the funding page retries through the same idempotent helper.
  void ensureUserPayoutWallet(user.id).catch((e: any) => {
    req.log?.warn?.({ userId: user.id, err: e?.message }, "initial Flutterwave payout wallet provisioning failed");
  });

  // Auto-send an email OTP so the user can verify their inbox before they finish
  // the signup flow. We still issue the JWT (the mobile app needs it to call
  // /auth/verify-otp from the verify screen), but the client treats `isVerified=false`
  // as a hard gate and routes to the verify-email screen.
  let otpDelivery: "email" | "logged" | "skipped" = "skipped";
  if (isEmailConfigured()) {
    try {
      const code = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      markOtpIssued(user.email, "verification");
      await db.insert(otpTable).values({ target: user.email, code, purpose: "verification", expiresAt });
      otpDelivery = "email";
      // Registration must wait until the verification code has actually been
      // handed to the mail provider. The client must receive this response before
      // it can continue to the OTP screen.
      await sendOtpEmail(user.email, code, "verification");
    } catch (e: any) {
      req.log.error({ err: e?.message, userId: user.id }, "signup OTP setup failed");
      res.status(502).json({ error: "Account was created, but we could not send your verification code. Please try signing in again." });
      return;
    }
  } else {
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    markOtpIssued(user.email, "verification");
    await db.insert(otpTable).values({ target: user.email, code, purpose: "verification", expiresAt });
    req.log.info({ target: user.email, code }, "signup OTP generated (email not configured)");
    otpDelivery = "logged";
  }

  // No authenticated session is created until the verification OTP is accepted.
  void sendWelcomeEmail(user.email, user.firstName).catch((e: any) => {
    req.log?.warn?.({ userId: user.id, err: e?.message }, "welcome email failed");
  });

  res.status(201).json({
    user: formatUser(user, 0),
    requiresEmailVerification: true,
    otpDelivery,
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Email-verification gate: if a user signed up but never confirmed their inbox,
  // do not promote them to a full session. Re-issue an OTP and tell the client to
  // route through the verify-email screen. We still hand back the JWT because the
  // verify screen needs it to call /auth/verify-otp from a logged-out state.
  if (!user.isVerified) {
    let otpDelivery: "email" | "logged" = "logged";
    try {
      const code = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      markOtpIssued(user.email, "verification");
      await db.insert(otpTable).values({ target: user.email, code, purpose: "verification", expiresAt });
      if (isEmailConfigured()) {
        otpDelivery = "email";
        // Do not mint a session until the user proves control of the inbox.
        await sendOtpEmail(user.email, code, "verification");
      } else {
        req.log.info({ target: user.email, code }, "login verification OTP generated (email not configured)");
      }
    } catch (e: any) {
      req.log.error({ err: e?.message, userId: user.id }, "login verification OTP email failed");
      res.status(502).json({ error: "We could not send your verification code. Please try again." });
      return;
    }
    res.status(200).json({
      email: user.email,
      requiresEmailVerification: true,
      otpDelivery,
    });
    return;
  }

  if (!LOGIN_OTP_ENABLED) {
    const wallet = await getOrCreateWallet(user.id);
    const dev = deviceInfo(req);
    const sid = await createSession(user.id, dev.name, dev.platform, dev.ip);
    const token = signToken(user.id, sid);
    res.json({
      user: formatUser(user, parseFloat(wallet.balance)),
      token,
      ...(user.isAdmin ? { adminToken: signAdminToken(user.id) } : {}),
    });
    return;
  }

  // When enabled, every verified user, including admins, must complete the
  // emailed login OTP before a session is minted.
  let otpDelivery: "email" | "logged" = "logged";
  try {
    const isResend = req.body?.resend === true;
    if (isResend && !enforceOtpResendCooldown(user.email, "login", res)) return;
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    markOtpIssued(user.email, "login");
    await db.insert(otpTable).values({ target: user.email, code, purpose: "login", expiresAt });
    if (isEmailConfigured()) {
      otpDelivery = "email";
      // Login is not complete until the OTP has been delivered. Keep the request
      // pending while the provider accepts the message so the client only shows
      // the OTP screen once the code has actually been sent.
      await sendOtpEmail(user.email, code, "login");
    } else req.log.info({ target: user.email, code }, "login OTP generated (email not configured)");
  } catch (e: any) {
    req.log.error({ err: e?.message, userId: user.id }, "login OTP email failed");
    // Do not advance to the OTP screen unless the provider accepted the code.
    res.status(502).json({ error: "We could not send your sign-in code. Please try again." });
    return;
  }
  res.json({ requiresOtp: true, email: user.email, otpDelivery });
});

// Second factor on login: verify the emailed code, then mint the real session.
// Short 6-digit codes have low entropy, so throttle guesses per email like the
// password-reset flow does.
const LOGIN_OTP_MAX_FAILS = 5;
const LOGIN_OTP_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_OTP_LOCKOUT_MS = 15 * 60 * 1000;
const loginOtpAttempts = new Map<string, { fails: number; firstAt: number; lockedUntil: number }>();

router.post("/auth/verify-login-otp", async (req, res): Promise<void> => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").trim();
  if (!email || !code) { res.status(400).json({ error: "Email and code are required" }); return; }

  const nowMs = Date.now();
  const guard = loginOtpAttempts.get(email);
  if (guard) {
    if (guard.lockedUntil > nowMs) {
      const mins = Math.ceil((guard.lockedUntil - nowMs) / 60000);
      res.status(429).json({ error: `Too many incorrect codes. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
      return;
    }
    if (nowMs - guard.firstAt > LOGIN_OTP_WINDOW_MS) loginOtpAttempts.delete(email);
  }
  const registerFail = () => {
    const g = loginOtpAttempts.get(email);
    if (!g || nowMs - g.firstAt > LOGIN_OTP_WINDOW_MS) {
      loginOtpAttempts.set(email, { fails: 1, firstAt: nowMs, lockedUntil: 0 });
      return;
    }
    g.fails += 1;
    if (g.fails >= LOGIN_OTP_MAX_FAILS) g.lockedUntil = nowMs + LOGIN_OTP_LOCKOUT_MS;
  };

  const now = new Date();
  const [otp] = await db.select().from(otpTable)
    .where(and(eq(otpTable.target, email), eq(otpTable.code, code), eq(otpTable.purpose, "login"), eq(otpTable.used, false)))
    .orderBy(desc(otpTable.createdAt));
  if (!otp || otp.expiresAt < now) {
    registerFail();
    res.status(400).json({ error: "Invalid or expired code. Please try again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) { res.status(404).json({ error: "Account not found" }); return; }

  // Atomically claim the OTP: only one request can flip used=false -> true.
  const claimed = await db.update(otpTable).set({ used: true })
    .where(and(eq(otpTable.id, otp.id), eq(otpTable.used, false)))
    .returning({ id: otpTable.id });
  if (claimed.length === 0) {
    res.status(400).json({ error: "This code was already used. Please request a new one." });
    return;
  }
  loginOtpAttempts.delete(email);

  const wallet = await getOrCreateWallet(user.id);
  const dev = deviceInfo(req);
  const sid = await createSession(user.id, dev.name, dev.platform, dev.ip);
  const token = signToken(user.id, sid);
  res.json({ user: formatUser(user, parseFloat(wallet.balance)), token, ...(user.isAdmin ? { adminToken: signAdminToken(user.id) } : {}) });
});

router.post("/auth/send-otp", async (req, res): Promise<void> => {
  // Defensively default `type` so old/stale mobile bundles that omit it keep
  // working — infer from the target shape. Previously this returned a 400
  // ("type: Required") which users hit on the verify-email "Resend code" path.
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  if (!rawBody.type && typeof rawBody.target === "string") {
    rawBody.type = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawBody.target) ? "email" : "phone";
  }
  const parsed = SendOtpBody.safeParse(rawBody);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    return;
  }

  const { target, purpose } = parsed.data;
  const purposeKey = (purpose ?? "verification") as "verification" | "withdraw" | "password_reset";
  if (!enforceOtpResendCooldown(target, purposeKey, res)) return;
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  markOtpIssued(target, purposeKey);

  await db.insert(otpTable).values({ target, code, purpose: purposeKey, expiresAt });

  // Email if it looks like an email address; otherwise log it (SMS not wired).
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target);
  if (looksLikeEmail && isEmailConfigured()) {
    try {
      await sendOtpEmail(target, code, purposeKey);
      res.json({ message: `OTP sent to ${target}. Check your inbox.` });
      return;
    } catch (e: any) {
      req.log.error({ err: e?.message }, "OTP email failed");
      res.status(502).json({ error: `Could not send OTP email: ${e?.message ?? "unknown"}` });
      return;
    }
  }
  req.log.info({ target, code }, "OTP generated (no email service for this target)");
  res.json({ message: `OTP generated for ${target} (check server logs — email not configured for this destination)` });
});

// ── PASSWORD RESET (in-app OTP flow) ───────────────────────────────────────
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  // User explicitly asked us to reveal when an email is not registered.
  if (!user) { res.status(404).json({ error: "This email is not registered. Please check and try again." }); return; }

  if (!isEmailConfigured()) {
    res.status(502).json({ error: "Email service is not configured. Please contact support." });
    return;
  }

  const isResend = req.body?.resend === true;
  if (isResend && !enforceOtpResendCooldown(email, "password_reset", res)) return;
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  markOtpIssued(email, "password_reset");
  await db.insert(otpTable).values({ target: email, code, purpose: "password_reset", expiresAt });

  try {
    await sendOtpEmail(email, code, "password_reset");
  } catch (e: any) {
    req.log.error({ err: e?.message }, "reset OTP email failed");
    res.status(502).json({ error: "Could not send reset email. Try again later." });
    return;
  }
  res.json({ message: `A password reset code has been sent to ${email}.` });
});

// In-memory brute-force guard for the password-reset OTP. A short 6-digit code
// has low entropy, so we throttle guesses per email: after MAX_FAILS wrong
// attempts inside the window the email is locked out for LOCKOUT_MS. Process-
// local (good enough to stop online guessing); resets clear on success.
const RESET_MAX_FAILS = 5;
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_LOCKOUT_MS = 15 * 60 * 1000;
const resetAttempts = new Map<string, { fails: number; firstAt: number; lockedUntil: number }>();

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").trim();
  const newPassword = String(req.body?.newPassword ?? "");
  if (!email || !code) { res.status(400).json({ error: "Email and reset code are required" }); return; }
  if (newPassword.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const nowMs = Date.now();
  const guard = resetAttempts.get(email);
  if (guard) {
    if (guard.lockedUntil > nowMs) {
      const mins = Math.ceil((guard.lockedUntil - nowMs) / 60000);
      res.status(429).json({ error: `Too many incorrect codes. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
      return;
    }
    if (nowMs - guard.firstAt > RESET_WINDOW_MS) resetAttempts.delete(email);
  }
  const registerFail = () => {
    const g = resetAttempts.get(email);
    if (!g || nowMs - g.firstAt > RESET_WINDOW_MS) {
      resetAttempts.set(email, { fails: 1, firstAt: nowMs, lockedUntil: 0 });
      return;
    }
    g.fails += 1;
    if (g.fails >= RESET_MAX_FAILS) g.lockedUntil = nowMs + RESET_LOCKOUT_MS;
  };

  const now = new Date();
  const [otp] = await db.select().from(otpTable)
    .where(and(eq(otpTable.target, email), eq(otpTable.code, code), eq(otpTable.purpose, "password_reset"), eq(otpTable.used, false)))
    .orderBy(desc(otpTable.createdAt));
  if (!otp || otp.expiresAt < now) {
    registerFail();
    res.status(400).json({ error: "Invalid or expired reset code. Please request a new one." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) { res.status(404).json({ error: "This email is not registered." }); return; }

  // Atomically claim the OTP: only one request can flip used=false -> true, so
  // concurrent submissions of the same code can't both reset the password.
  const claimed = await db.update(otpTable).set({ used: true })
    .where(and(eq(otpTable.id, otp.id), eq(otpTable.used, false)))
    .returning({ id: otpTable.id });
  if (claimed.length === 0) {
    res.status(400).json({ error: "This reset code was already used. Please request a new one." });
    return;
  }
  resetAttempts.delete(email);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  await notifyUser({
    userId: user.id, type: "warning",
    title: "Your password was changed",
    body: "Your CipherPay password was just reset. If this wasn't you, contact support immediately and secure your email account.",
    email: true,
  });
  res.json({ message: "Password reset successfully. You can now log in with your new password." });
});

router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    return;
  }

  const { target, code } = parsed.data;
  const now = new Date();

  const [otp] = await db.select().from(otpTable)
    .where(and(eq(otpTable.target, target), eq(otpTable.code, code), eq(otpTable.used, false)))
    .orderBy(desc(otpTable.createdAt));

  if (!otp || otp.used || otp.code !== code || otp.expiresAt < now) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  await db.update(otpTable).set({ used: true }).where(eq(otpTable.id, otp.id));

  if (otp.purpose === "verification") {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, target));
    if (user) {
      const [verifiedUser] = await db.update(usersTable)
        .set({ isVerified: true })
        .where(eq(usersTable.id, user.id))
        .returning();

      // Referral rewards are released only after the new user proves control of
      // their email. This prevents unverified signups from farming wallet credit.
      const REFERRAL_BONUS_REFERRER = 200;
      const REFERRAL_BONUS_REFEREE = 200;
      const referredBy = (verifiedUser ?? user).referredBy;
      if (referredBy) {
        try {
          const [referrer] = await db.select().from(usersTable)
            .where(eq(usersTable.referralCode, referredBy)).limit(1);
          if (referrer && referrer.id !== user.id) {
            const existingRewards = await db.select({ metadata: transactionsTable.metadata })
              .from(transactionsTable)
              .where(and(
                eq(transactionsTable.userId, referrer.id),
                eq(transactionsTable.type, "referral"),
              ))
              .orderBy(desc(transactionsTable.createdAt))
              .limit(50);
            const alreadyRewarded = existingRewards.some((tx) =>
              tx.metadata?.includes(`"referredUserId":${user.id}`) ?? false,
            );
            // The OTP is single-use, so this normally executes once. Keep the
            // metadata guard as a second line of protection against duplicate credits.
            if (!alreadyRewarded) {
              await creditWallet(referrer.id, REFERRAL_BONUS_REFERRER, `Referral bonus — ${user.firstName} joined CipherPay`, "referral", { referredUserId: user.id });
              await creditWallet(user.id, REFERRAL_BONUS_REFEREE, "Welcome bonus — you joined via a referral", "referral", { referrerId: referrer.id });
              await notifyUser({
                userId: referrer.id,
                title: "Referral bonus 🎉",
                body: `You earned ₦${REFERRAL_BONUS_REFERRER.toLocaleString()} for inviting ${user.firstName} to CipherPay!`,
                type: "success",
              });
            }
          }
        } catch (e: any) {
          req.log.warn({ err: e?.message, userId: user.id }, "referral reward credit failed — non-fatal");
        }
      }

      const dev = deviceInfo(req);
      const sid = await createSession(user.id, dev.name, dev.platform, dev.ip);
      const token = signToken(user.id, sid);
      const wallet = await getOrCreateWallet(user.id);
      res.json({
        message: "OTP verified successfully",
        token,
        user: formatUser(verifiedUser ?? user, parseFloat(wallet.balance)),
        ...(user.isAdmin ? { adminToken: signAdminToken(user.id) } : {}),
      });
      return;
    }
  }

  res.json({ message: "OTP verified successfully" });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);

  if (isNaN(userId)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (!user.userCode) {
    const code = generateUserCode();
    const [updated] = await db.update(usersTable).set({ userCode: code }).where(eq(usersTable.id, user.id)).returning();
    if (updated) Object.assign(user, updated);
  }
  const wallet = await getOrCreateWallet(user.id);
  res.json(formatUser(user, parseFloat(wallet.balance)));
});

router.get("/auth/chat-key", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (!Number.isFinite(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({ chatPublicKey: usersTable.chatPublicKey }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ publicKey: user.chatPublicKey ?? null });
});

router.post("/auth/chat-key", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (!Number.isFinite(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const publicKey = typeof req.body?.publicKey === "string" ? req.body.publicKey.trim() : "";
  if (publicKey.length < 40 || publicKey.length > 4000) { res.status(400).json({ error: "Invalid chat public key." }); return; }
  const [user] = await db.update(usersTable).set({ chatPublicKey: publicKey }).where(eq(usersTable.id, userId)).returning({ id: usersTable.id });
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ saved: true });
});

router.patch("/auth/update-profile", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, userId)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const wallet = await getOrCreateWallet(user.id);
  res.json(formatUser(user, parseFloat(wallet.balance)));
});

// Profile picture upload — accepts a base64 data URL (same pattern as KYC) so
// the mobile client can use ImagePicker's `base64: true` and POST it directly,
// no multipart parsing needed. Returns the updated user.
router.post("/auth/avatar", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }

  const image = (req.body as any)?.image;
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Image is required" });
    return;
  }

  // Verify the user exists BEFORE writing the file so we don't orphan bytes
  // on disk for a deleted/invalid user.
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  let url: string;
  try {
    url = await saveAvatarDataUrl(userId, image);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Could not save image" });
    return;
  }

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const rows = await db.update(usersTable).set({ avatarUrl: url }).where(eq(usersTable.id, userId)).returning();
    user = rows[0];
  } catch (e) {
    // DB update failed — clean up the file we just wrote so it doesn't leak.
    const orphan = path.join(AVATAR_DIR, path.basename(url));
    await fs.unlink(orphan).catch(() => {});
    throw e;
  }
  if (!user) {
    const orphan = path.join(AVATAR_DIR, path.basename(url));
    await fs.unlink(orphan).catch(() => {});
    res.status(404).json({ error: "User not found" });
    return;
  }
  const wallet = await getOrCreateWallet(user.id);
  res.json(formatUser(user, parseFloat(wallet.balance)));
});

// ─── DEVICE SESSIONS ─────────────────────────────────────────────────────────
// Real logged-in devices: each login/registration creates a session row, and
// the JWT carries its id. Revoking a session invalidates that device's token
// (enforced in the /api auth middleware).
router.get("/auth/sessions", async (req, res): Promise<void> => {
  const userId = getUserIdFromHeaders(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawSid = req.headers["x-session-id"];
  const currentSid = parseInt(Array.isArray(rawSid) ? rawSid[0] : (rawSid ?? ""), 10);
  const rows = await listSessions(userId);
  res.json({
    data: rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      platform: s.platform,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      current: !isNaN(currentSid) && s.id === currentSid,
    })),
  });
});

router.post("/auth/sessions/:id/revoke", async (req, res): Promise<void> => {
  const userId = getUserIdFromHeaders(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = parseInt(String(req.params.id), 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }
  const ok = await revokeSession(userId, sessionId);
  if (!ok) { res.status(404).json({ error: "Session not found" }); return; }
  res.json({ success: true });
});

router.post("/auth/sessions/revoke-all", async (req, res): Promise<void> => {
  const userId = getUserIdFromHeaders(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawSid = req.headers["x-session-id"];
  const currentSid = parseInt(Array.isArray(rawSid) ? rawSid[0] : (rawSid ?? ""), 10);
  await revokeAllExcept(userId, isNaN(currentSid) ? null : currentSid);
  res.json({ success: true });
});

// ─── APP-LOCK PIN ──────────────────────────────────────────────────────────
// 6-digit numeric PIN used by the mobile app to lock the app on backgrounding.
// It is NOT a password substitute: it does not log the user in. The auth flow
// stays JWT-based. We just store a bcrypt hash of the PIN on the user row.
// Forgotten PINs can only be cleared by an admin (after verifying identity via
// support); a self-serve reset would defeat the purpose of the lock.
const PIN_RE = /^\d{6}$/;
function pinIssue(v: any): string | null {
  if (typeof v !== "string") return "PIN is required";
  if (!PIN_RE.test(v)) return "PIN must be exactly 6 digits";
  return null;
}

router.get("/auth/pin/status", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [u] = await db.select({ pinHash: usersTable.pinHash, pinUpdatedAt: usersTable.pinUpdatedAt }).from(usersTable).where(eq(usersTable.id, userId));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ hasPin: !!u.pinHash, pinUpdatedAt: u.pinUpdatedAt?.toISOString() ?? null });
});

router.post("/auth/pin/set", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = (req.body ?? {}) as { pin?: string; currentPin?: string; password?: string };
  const err = pinIssue(body.pin);
  if (err) { res.status(400).json({ error: err }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Re-authenticate the caller. If they already have a PIN, the current PIN
  // is required (so a stolen unlocked session can't silently change the PIN).
  // If they don't yet have one, accept the account password instead. Either
  // way the device alone (without one secret the user knows) cannot enroll.
  if (user.pinHash) {
    if (!body.currentPin || !(await bcrypt.compare(body.currentPin, user.pinHash))) {
      res.status(400).json({ error: "Current PIN is incorrect" }); return;
    }
  } else {
    if (!body.password || !(await bcrypt.compare(body.password, user.passwordHash))) {
      res.status(400).json({ error: "Password is incorrect" }); return;
    }
  }

  const pinHash = await bcrypt.hash(body.pin!, 10);
  await db.update(usersTable).set({ pinHash, pinUpdatedAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ message: "PIN saved", hasPin: true });
});

// In-memory PIN attempt tracker. After PIN_MAX_ATTEMPTS consecutive failures
// the account is locked out for PIN_LOCKOUT_MS — the user must wait or sign
// in fresh with their password. Per-process; survives until the server
// restarts. For a single-instance deployment this is sufficient; for a
// multi-instance setup, swap for a shared store (e.g. Redis).
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
const pinAttempts = new Map<number, { count: number; lockedUntil: number }>();

router.post("/auth/pin/verify", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = Date.now();
  let state = pinAttempts.get(userId);
  if (state && state.lockedUntil > now) {
    const mins = Math.ceil((state.lockedUntil - now) / 60000);
    res.status(429).json({ error: `Too many incorrect attempts. Try again in ${mins} min, or sign in again with your password.`, lockedUntil: state.lockedUntil });
    return;
  }
  // Cooldown elapsed (or never locked): give the user a fresh window of
  // attempts. Without this, a previously-locked account would re-trigger
  // the 15-min lock on the very first wrong PIN after cooldown.
  if (state && state.lockedUntil > 0 && state.lockedUntil <= now) {
    pinAttempts.delete(userId);
    state = undefined;
  }

  const err = pinIssue((req.body ?? {}).pin);
  if (err) { res.status(400).json({ error: err }); return; }
  const [u] = await db.select({ pinHash: usersTable.pinHash }).from(usersTable).where(eq(usersTable.id, userId));
  // Drift case: client believes a PIN is set but the server has none (e.g.
  // admin cleared it while the user was offline). Return a dedicated code
  // so the client can auto-unlock and update its local flag, rather than
  // trapping the user on the lock screen.
  if (!u || !u.pinHash) { res.status(409).json({ error: "No PIN set on this account", code: "PIN_NOT_SET" }); return; }
  const ok = await bcrypt.compare((req.body as any).pin, u.pinHash);
  if (!ok) {
    const next = (state?.count ?? 0) + 1;
    const lockedUntil = next >= PIN_MAX_ATTEMPTS ? now + PIN_LOCKOUT_MS : 0;
    pinAttempts.set(userId, { count: next, lockedUntil });
    const remaining = Math.max(0, PIN_MAX_ATTEMPTS - next);
    if (lockedUntil) {
      res.status(429).json({ error: "Too many incorrect attempts. Try again in 15 minutes, or sign in again with your password.", lockedUntil });
    } else {
      res.status(401).json({ error: `Incorrect PIN. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`, remaining });
    }
    return;
  }
  pinAttempts.delete(userId);
  res.json({ ok: true });
});

router.post("/auth/pin/remove", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { password } = (req.body ?? {}) as { password?: string };
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  // Require password so a momentarily-unlocked session can't disable the lock.
  if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(400).json({ error: "Password is incorrect" }); return;
  }
  await db.update(usersTable).set({ pinHash: null, pinUpdatedAt: null }).where(eq(usersTable.id, userId));
  res.json({ message: "PIN removed", hasPin: false });
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) { res.status(400).json({ error: "Current password is incorrect" }); return; }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, userId));
  res.json({ message: "Password changed successfully" });
});

// ── Referral stats ────────────────────────────────────────────────────────────
const REFERRAL_BONUS_REFERRER_AMOUNT = 100;

router.get("/auth/referral/stats", async (req, res): Promise<void> => {
  const rawId = req.headers["x-user-id"];
  const userId = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const referred = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, createdAt: usersTable.createdAt })
    .from(usersTable).where(eq(usersTable.referredBy, user.referralCode ?? ""));
  res.json({
    referralCode: user.referralCode,
    count: referred.length,
    totalEarned: referred.length * REFERRAL_BONUS_REFERRER_AMOUNT,
    bonusPerReferral: REFERRAL_BONUS_REFERRER_AMOUNT,
    referees: referred.map(r => ({ name: `${r.firstName} ${r.lastName.charAt(0)}.`, joinedAt: r.createdAt.toISOString() })),
  });
});

export default router;
