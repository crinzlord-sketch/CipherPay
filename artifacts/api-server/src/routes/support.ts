import { Router, type IRouter } from "express";
import { and, eq, desc, gt, sql, ne, isNull, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";

const SUPPORT_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "support");
const SUPPORT_UPLOAD_BASE = "/api/uploads/support";

// Strip internal fields (assignedAdminId) before sending chat metadata to the user —
// the user must never learn the admin's identity; they only ever see "Support".
function toUserChatDto(c: {
  id: number; userId: number; status: string; unreadForUser: number;
  lastMessageAt: Date | string; createdAt: Date | string; agentTypingAt: Date | string | null;
}) {
  return {
    id: c.id, userId: c.userId, status: c.status,
    unreadForUser: c.unreadForUser, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt,
    // Surface only the OTHER side's typing flag — never echo the user's own pings back.
    agentTypingAt: c.agentTypingAt,
  };
}
import { db, usersTable, supportChatsTable, supportMessagesTable, notificationsTable } from "@workspace/db";
import { sendMail, sendAdminAlertEmail, isEmailConfigured } from "../lib/email";
import { getBotReply, WELCOME_MESSAGE } from "../lib/support-bot";
import { notifyUser } from "../lib/notifications";

const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL?.trim() ?? "";

// Chats are historical records. Closing a conversation only changes its status;
// messages and attachments must remain available to the user and support team.
export async function clearSupportChat(chatId: number): Promise<void> {
  const [chat] = await db.select({ status: supportChatsTable.status })
    .from(supportChatsTable).where(eq(supportChatsTable.id, chatId));
  if (!chat || chat.status === "closed") return;
  await db.update(supportChatsTable).set({
    status: "closed",
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    unreadForUser: 0,
    unreadForAdmin: 0,
  }).where(eq(supportChatsTable.id, chatId));
  await db.insert(supportMessagesTable).values({
    chatId,
    sender: "system",
    body: "This conversation has ended. Your messages and attachments remain available in Support history.",
  });
}

function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  const n = id ? parseInt(id, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function requireUser(req: any, res: any): number | null {
  const id = getUserId(req);
  if (!id) { res.status(401).json({ error: "Sign in to use support chat" }); return null; }
  return id;
}

const router: IRouter = Router();

async function notifyAllAdmins(title: string, body: string, link: string | null = null): Promise<void> {
  const admins = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true));
  if (!admins.length) return;
  await db.insert(notificationsTable).values(admins.map((admin) => ({
    userId: admin.id,
    type: "admin_support",
    title,
    body,
    link,
  })));
}

// ── FAQ + legacy email form (kept for backwards compat) ──────────────────────
const FAQ = [
  { id: "fund-wallet", q: "How do I fund my wallet?", a: "Wallet → Fund → enter amount → pay securely with card or bank transfer in the app. Funds arrive instantly." },
  { id: "withdraw", q: "How do I send money to a bank?", a: "Wallet → Send → choose 'Bank account' → pick the bank, enter the account number → enter amount → confirm. Small tiered fee; arrives in minutes." },
  { id: "kyc-limits", q: "How do KYC levels work?", a: "Level 0: ₦50,000/day. Level 1 (BVN/NIN): ₦200,000/day. Level 2 (full KYC): ₦1,000,000/day." },
  { id: "refunds", q: "Failed transactions and refunds", a: "If a service fails, your wallet is auto-refunded within minutes. Check Transactions for the refund entry." },
  { id: "social-orders", q: "Social boost order is pending", a: "Delivery time varies: Instagram (1–6h), TikTok (instant–30m), YouTube (24–72h)." },
];
router.get("/support/faq", (_req, res) => { res.json({ items: FAQ }); });

router.post("/support/contact", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const { subject, message, category } = (req.body ?? {}) as { subject?: string; message?: string; category?: string };
  if (!message || message.trim().length < 5) { res.status(400).json({ error: "Please describe your issue (at least 5 characters)." }); return; }
  if (!subject || subject.trim().length < 3) { res.status(400).json({ error: "Please provide a short subject." }); return; }
  let userInfo = "Anonymous (not logged in)";
  let replyEmail = "";
  if (userId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (u) { userInfo = `${u.firstName} ${u.lastName} (#${u.id}) — ${u.email} — KYC Level ${u.kycLevel}`; replyEmail = u.email; }
  }

  const safeMessage = String(message).replace(/[<>]/g, (c) => ({ "<": "&lt;", ">": "&gt;" }[c] ?? c));
  const html = `<div style="font-family:-apple-system,sans-serif;max-width:560px;padding:24px;background:#15162a;color:#e7e7f0;border-radius:14px"><h2 style="color:#a78bfa">New CipherPay Support Request</h2><p style="color:#8b8c9e">Category: <strong style="color:#fff">${category ?? "general"}</strong></p><div style="background:#0b0c1a;border:1px solid #2a2b45;border-radius:10px;padding:14px;margin-bottom:14px"><div style="color:#8b8c9e;font-size:11px;text-transform:uppercase;letter-spacing:1px">From</div><div style="color:#fff">${userInfo}</div></div><div style="background:#0b0c1a;border:1px solid #2a2b45;border-radius:10px;padding:14px;margin-bottom:14px"><div style="color:#8b8c9e;font-size:11px;text-transform:uppercase;letter-spacing:1px">Subject</div><div style="color:#fff">${String(subject).replace(/[<>]/g, "")}</div></div><div style="background:#0b0c1a;border:1px solid #2a2b45;border-radius:10px;padding:14px"><div style="color:#8b8c9e;font-size:11px;text-transform:uppercase;letter-spacing:1px">Message</div><div style="color:#fff;white-space:pre-wrap">${safeMessage}</div></div></div>`;
  // Store an unread admin alert first so support requests are not lost if
  // the email provider is temporarily unavailable.
  try {
    await notifyAllAdmins(
      "New support request",
      `${subject} — ${userInfo}`,
      "/admin?tab=support",
    );
  } catch (e: any) {
    console.warn("admin in-app support alert failed", e?.message ?? String(e));
  }

  // Email is best-effort. A Brevo suspension must not make the user's support
  // request disappear; the admin console notification remains available.
  try {
    if (isEmailConfigured() && SUPPORT_INBOX) {
      await sendAdminAlertEmail(
        "New support request",
        `Category: ${category ?? "general"}\n\nFrom: ${userInfo}\n\nSubject: ${subject}\n\n${message}`,
        SUPPORT_INBOX,
      );
    }
  } catch (e: any) {
    console.warn("admin support email failed", e?.message ?? String(e));
  }

  res.json({ success: true, message: "We've received your message. Our team will get back to you within 24 hours." });
});

// ── CHAT ─────────────────────────────────────────────────────────────────────
// Get-or-create the current active chat for the user, with all messages.
router.get("/support/chat", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  let [chat] = await db.select().from(supportChatsTable)
    .where(and(eq(supportChatsTable.userId, userId), ne(supportChatsTable.status, "closed")))
    .orderBy(desc(supportChatsTable.lastMessageAt))
    .limit(1);
  if (!chat) {
    [chat] = await db.insert(supportChatsTable).values({ userId, status: "ai" }).returning();
    await db.insert(supportMessagesTable).values({ chatId: chat.id, sender: "bot", body: WELCOME_MESSAGE });
  }
  // Mark user-side unread cleared on open
  if (chat.unreadForUser > 0) {
    await db.update(supportChatsTable).set({ unreadForUser: 0 }).where(eq(supportChatsTable.id, chat.id));
    chat.unreadForUser = 0;
  }
  const messages = await db.select().from(supportMessagesTable)
    .where(eq(supportMessagesTable.chatId, chat.id))
    .orderBy(supportMessagesTable.id);
  res.json({ chat: toUserChatDto(chat), messages });
});

// Closed conversations are retained as the user's support history. The current
// active conversation is intentionally excluded because it is returned above.
router.get("/support/history", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const chats = await db.select().from(supportChatsTable)
    .where(and(eq(supportChatsTable.userId, userId), eq(supportChatsTable.status, "closed")))
    .orderBy(desc(supportChatsTable.lastMessageAt));
  const data = await Promise.all(chats.map(async (chat) => ({
    chat: toUserChatDto(chat),
    messages: await db.select().from(supportMessagesTable)
      .where(eq(supportMessagesTable.chatId, chat.id))
      .orderBy(supportMessagesTable.id),
  })));
  res.json({ data });
});

// Poll: only fetch messages newer than `since` id, plus latest chat status
router.get("/support/chat/:id/poll", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const since = parseInt(String(req.query.since ?? "0"), 10) || 0;
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  const messages = await db.select().from(supportMessagesTable)
    .where(and(eq(supportMessagesTable.chatId, id), gt(supportMessagesTable.id, since)))
    .orderBy(supportMessagesTable.id);
  // If user is actively polling, clear their unread counter
  if (chat.unreadForUser > 0) {
    await db.update(supportChatsTable).set({ unreadForUser: 0 }).where(eq(supportChatsTable.id, id));
    chat.unreadForUser = 0;
  }
  res.json({ chat: toUserChatDto(chat), messages });
});

// User sends a message. If status='ai' and no agent has joined, the bot replies.
// If status='waiting' or 'live', the message is just stored and surfaced to admin.
router.post("/support/chat/:id/message", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const body = String((req.body ?? {}).body ?? "").trim();
  const imageUrl = String((req.body ?? {}).imageUrl ?? "").trim() || null;
  if (!body && !imageUrl) { res.status(400).json({ error: "Message cannot be empty" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "Message too long (max 4000 chars)" }); return; }
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "closed") { res.status(409).json({ error: "This chat has been closed. Start a new one." }); return; }

  const msgBody = body || (imageUrl ? "📷 Image" : "");
  const [userMsg] = await db.insert(supportMessagesTable).values({ chatId: id, sender: "user", body: msgBody, imageUrl }).returning();
  await db.update(supportChatsTable)
    .set({ lastMessageAt: new Date(), updatedAt: new Date(), unreadForAdmin: sql`${supportChatsTable.unreadForAdmin} + 1` })
    .where(eq(supportChatsTable.id, id));

  const created: typeof userMsg[] = [userMsg];
  // Bot reply: only emit if the chat is STILL in 'ai' state. An admin may have
  // joined between the initial read and now — in that case we must not bot-reply.
  // The atomic UPDATE...RETURNING below acts as a conditional guard: if the row
  // is no longer 'ai', no row is updated and we skip the reply.
  const [stillAi] = await db.update(supportChatsTable)
    .set({ lastMessageAt: new Date() })
    .where(and(eq(supportChatsTable.id, id), eq(supportChatsTable.status, "ai")))
    .returning({ id: supportChatsTable.id });
  if (stillAi) {
    const reply = await getBotReply(body);
    const [botMsg] = await db.insert(supportMessagesTable).values({ chatId: id, sender: "bot", body: reply.body }).returning();
    created.push(botMsg);
  }
  res.json({ messages: created, chat: { id, status: stillAi ? "ai" : chat.status } });
});

// User requests a live agent: status → waiting, system banner, notify admins
router.post("/support/chat/:id/request-agent", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "live") { res.status(409).json({ error: "A support agent is already in this chat." }); return; }
  if (chat.status === "waiting") { res.status(409).json({ error: "You're already in the queue — a support agent will be with you shortly." }); return; }
  // Conditional update: only flip ai → waiting. If admin raced ahead to live,
  // do nothing and tell the client to refresh — never downgrade a live chat.
  const promoted = await db.update(supportChatsTable)
    .set({ status: "waiting", updatedAt: new Date(), lastMessageAt: new Date() })
    .where(and(eq(supportChatsTable.id, id), eq(supportChatsTable.status, "ai")))
    .returning({ id: supportChatsTable.id });
  if (promoted.length === 0) {
    res.status(409).json({ error: "Status changed — please refresh." }); return;
  }
  const [sysMsg] = await db.insert(supportMessagesTable).values({
    chatId: id, sender: "system",
    body: "You're in the queue for a live Support agent. Average wait time is a few minutes — feel free to keep typing and we'll see your messages when we join.",
  }).returning();
  // Notify all admins in the console as an unread support alert.
  try {
    await notifyAllAdmins(
      "Live support requested",
      `${who} is waiting for a live support agent. Open the Support inbox.`,
      `/admin?tab=support&chatId=${id}`,
    );
  } catch (e: any) {
    console.warn("admin in-app live support alert failed", e?.message ?? String(e));
  }

  // Notify all admins
  try {
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isAdmin, true));
    const [u] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    const who = u ? `${u.firstName} ${u.lastName} (${u.email})` : `User #${userId}`;
    // Set `email: true` so admins who aren't currently in the app still get
    // pinged in their inbox. Sends from the same Gmail account we use for OTPs,
    // so no extra config required. Each notifyUser swallows its own errors,
    // but Promise.all rejects on the first throw — keep the per-call catch.
    await Promise.all(admins.map((a) => notifyUser({
      userId: a.id, type: "warning", title: "Support — agent requested",
      body: `${who} is waiting for a live agent. Open the Support inbox to join.`,
       link: `/admin?tab=support&chatId=${id}`,
      email: true,
    }).catch(() => {})));
    // Also send a direct email to the live support inbox so the operator
    // always gets a notification even if they have no admin account in-app.
    const LIVE_SUPPORT_ALERT = "mrxannoymos@gmail.com";
    if (isEmailConfigured()) {
      const webBaseUrl = (
        process.env.PUBLIC_WEB_URL ??
        (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : "http://localhost")
      ).replace(/\/+$/, "");
      const alertHtml = `<div style="font-family:-apple-system,sans-serif;max-width:560px;padding:24px;background:#15162a;color:#e7e7f0;border-radius:14px">
        <h2 style="color:#a78bfa">🔔 Live Support Requested</h2>
        <p style="color:#cfd0e0"><strong style="color:#fff">${who}</strong> is waiting for a live support agent.</p>
         <p style="margin:16px 0"><a href="${webBaseUrl}/admin?tab=support&chatId=${id}" style="background:#8b5cf6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;display:inline-block">Open Chat #${id}</a></p>
        <p style="color:#6b6c85;font-size:13px">CipherPay Admin Alert</p>
      </div>`;
      sendMail(LIVE_SUPPORT_ALERT, `[CipherPay] Live support requested by ${who}`, alertHtml).catch(() => {});
    }
  } catch { /* best-effort */ }
  res.json({ message: sysMsg });
});

// In-memory per-chat typing-ping throttle. Clients debounce at 2.2s, so anything
// faster than ~1.5s is either a bug or someone hitting the endpoint directly to
// burn DB writes. We early-exit before the UPDATE to keep this side cheap.
const TYPING_THROTTLE_MS = 1500;
const _typingLastUser = new Map<number, number>();
const _typingLastAgent = new Map<number, number>();
// Bound the maps to prevent unbounded memory growth in long-running processes.
function _prune(m: Map<number, number>) {
  if (m.size <= 5000) return;
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of m) if (v < cutoff) m.delete(k);
}

// User typing ping — debounced from the client every ~2s while they're actively typing.
router.post("/support/chat/:id/typing", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid chat id" }); return; }
  const now = Date.now();
  const last = _typingLastUser.get(id) ?? 0;
  if (now - last < TYPING_THROTTLE_MS) { res.json({ success: true, throttled: true }); return; }
  _typingLastUser.set(id, now); _prune(_typingLastUser);
  // Cheap ownership guard via a conditional UPDATE — no extra SELECT round-trip.
  const updated = await db.update(supportChatsTable)
    .set({ userTypingAt: new Date() })
    .where(and(eq(supportChatsTable.id, id), eq(supportChatsTable.userId, userId)))
    .returning({ id: supportChatsTable.id });
  if (updated.length === 0) { res.status(404).json({ error: "Chat not found" }); return; }
  res.json({ success: true });
});

// Exported for the admin route to share the same agent-side throttle map.
export const _typingAgentThrottle = {
  shouldWrite(chatId: number): boolean {
    const now = Date.now();
    const last = _typingLastAgent.get(chatId) ?? 0;
    if (now - last < TYPING_THROTTLE_MS) return false;
    _typingLastAgent.set(chatId, now); _prune(_typingLastAgent);
    return true;
  },
};

// User can end the chat themselves
router.post("/support/chat/:id/close", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  await clearSupportChat(id);
  res.json({ success: true });
});

// User submits a 1–5 star rating after the chat ends
router.post("/support/chat/:id/rate", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const rating = parseInt(String((req.body ?? {}).rating ?? ""), 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be 1–5" }); return;
  }
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  await db.update(supportChatsTable).set({ rating, updatedAt: new Date() }).where(eq(supportChatsTable.id, id));
  res.json({ success: true });
});

// User uploads an image to attach to a chat message.
// Accepts { imageData: "data:image/jpeg;base64,..." }, saves to disk, returns the URL.
router.post("/support/chat/:id/upload-image", async (req, res): Promise<void> => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = parseInt(String(req.params.id ?? ""), 10);
  const [chat] = await db.select().from(supportChatsTable).where(eq(supportChatsTable.id, id));
  if (!chat || chat.userId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  if (chat.status === "closed") { res.status(409).json({ error: "Chat is closed" }); return; }
  const imageData = String((req.body ?? {}).imageData ?? "");
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!match) { res.status(400).json({ error: "Invalid image data" }); return; }
  const mime = match[1];
  const b64 = match[2];
  if (b64.length > 2_000_000) { res.status(413).json({ error: "Image too large (max ~1.5 MB)" }); return; }
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const filename = `s${id}-${Date.now()}.${ext}`;
  const buf = Buffer.from(b64, "base64");
  await fs.mkdir(SUPPORT_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(SUPPORT_UPLOAD_DIR, filename), buf);
  res.json({ url: `${SUPPORT_UPLOAD_BASE}/${filename}` });
});

export default router;
// silence unused — reserved for potential future use
export const _supportUnused = { isNull, inArray };
