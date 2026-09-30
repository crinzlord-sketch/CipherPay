import { Router, type IRouter } from "express";
import { and, asc, desc, eq, or, inArray } from "drizzle-orm";
import { db, usersTable, directChatsTable, directMessagesTable, blockedUsersTable } from "@workspace/db";
import path from "path";
import fs from "fs/promises";

const router: IRouter = Router();
const CHAT_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "chat");
const CHAT_PUBLIC_BASE = "/api/uploads/chat";

function userId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}
function orderedPair(a: number, b: number): [number, number] { return a < b ? [a, b] : [b, a]; }
async function blocked(a: number, b: number) {
  const rows = await db.select({ id: blockedUsersTable.id }).from(blockedUsersTable)
    .where(or(and(eq(blockedUsersTable.blockerId, a), eq(blockedUsersTable.blockedId, b)), and(eq(blockedUsersTable.blockerId, b), eq(blockedUsersTable.blockedId, a)))).limit(1);
  return rows.length > 0;
}
async function chatFor(id: number, me: number) {
  const [chat] = await db.select().from(directChatsTable).where(eq(directChatsTable.id, id));
  if (!chat || (chat.userOneId !== me && chat.userTwoId !== me)) return null;
  return chat;
}
async function saveChatImage(me: number, dataUrl: string) {
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Image must be JPG, PNG, WebP or GIF.");
  const buf = Buffer.from(m[2] ?? "", "base64");
  if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error("Image is too large (max 8MB).");
  await fs.mkdir(CHAT_UPLOAD_DIR, { recursive: true });
  const ext = (m[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const filename = `c${me}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(CHAT_UPLOAD_DIR, filename), buf);
  return `${CHAT_PUBLIC_BASE}/${filename}`;
}

router.get("/chat/gifs", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const key = process.env.GIPHY_API_KEY?.trim();
  if (!key) { res.json({ enabled: false, gifs: [] }); return; }
  const q = String(req.query.q ?? "trending").trim().slice(0, 80);
  try {
    const response = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=18&rating=pg-13`);
    const data: any = await response.json();
    res.json({ enabled: true, gifs: (data.data ?? []).map((g: any) => ({ id: g.id, title: g.title, url: g.images?.fixed_width?.url ?? g.images?.original?.url })).filter((g: any) => g.url) });
  } catch { res.status(502).json({ error: "GIF search is temporarily unavailable." }); }
});

router.get("/chat/list", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chats = await db.select().from(directChatsTable).where(or(eq(directChatsTable.userOneId, me), eq(directChatsTable.userTwoId, me))).orderBy(desc(directChatsTable.lastMessageAt));
  const visible = chats.filter(c => c.userOneId === me ? !c.deletedOne : !c.deletedTwo);
  const otherIds = visible.map(c => c.userOneId === me ? c.userTwoId : c.userOneId);
  const people = otherIds.length ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, avatarUrl: usersTable.avatarUrl, gender: usersTable.gender, userCode: usersTable.userCode }).from(usersTable).where(inArray(usersTable.id, otherIds)) : [];
  const byId = new Map(people.map(p => [p.id, p]));
  const rows = await Promise.all(visible.map(async c => {
    const otherId = c.userOneId === me ? c.userTwoId : c.userOneId;
    const [last] = await db.select().from(directMessagesTable).where(eq(directMessagesTable.chatId, c.id)).orderBy(desc(directMessagesTable.id)).limit(1);
    return { id: c.id, other: byId.get(otherId), lastMessage: last ?? null, lastMessageAt: c.lastMessageAt, background: c.userOneId === me ? c.backgroundOne : c.backgroundTwo };
  }));
  res.json({ chats: rows.filter(r => r.other) });
});

router.post("/chat/open", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const other = Number(req.body?.userId);
  if (!Number.isInteger(other) || other === me) { res.status(400).json({ error: "Invalid user." }); return; }
  const [one, two] = orderedPair(me, other);
  if (await blocked(me, other)) { res.status(403).json({ error: "This user is blocked. Unblock them before chatting." }); return; }
  let [chat] = await db.select().from(directChatsTable).where(and(eq(directChatsTable.userOneId, one), eq(directChatsTable.userTwoId, two))).limit(1);
  if (!chat) [chat] = await db.insert(directChatsTable).values({ userOneId: one, userTwoId: two }).returning();
  if (!chat) { res.status(500).json({ error: "Could not open chat." }); return; }
  if ((chat.userOneId === me && chat.deletedOne) || (chat.userTwoId === me && chat.deletedTwo)) {
    await db.update(directChatsTable).set(chat.userOneId === me ? { deletedOne: false } : { deletedTwo: false }).where(eq(directChatsTable.id, chat.id));
  }
  res.json({ chatId: chat.id });
});

router.get("/chat/:id", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  const otherId = chat.userOneId === me ? chat.userTwoId : chat.userOneId;
  const [other] = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, avatarUrl: usersTable.avatarUrl, gender: usersTable.gender, userCode: usersTable.userCode, chatPublicKey: usersTable.chatPublicKey }).from(usersTable).where(eq(usersTable.id, otherId));
  const messages = await db.select().from(directMessagesTable).where(eq(directMessagesTable.chatId, chat.id)).orderBy(asc(directMessagesTable.id));
  res.json({ chat, other, messages, blocked: await blocked(me, otherId), background: chat.userOneId === me ? chat.backgroundOne : chat.backgroundTwo });
});

router.post("/chat/:id/message", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  const other = chat.userOneId === me ? chat.userTwoId : chat.userOneId;
  if (await blocked(me, other)) { res.status(403).json({ error: "You cannot send messages in this chat." }); return; }
  // Chat messages are intentionally stored as a simple JSON payload so the
  // sender can immediately render the exact same text/image/GIF it sent.
  // No client-side encryption envelope is used by the chat UI.
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) { res.status(400).json({ error: "Message is empty." }); return; }
  if (body.length > 16 * 1024 * 1024) { res.status(400).json({ error: "Message is too large." }); return; }
  let payload: any;
  try { payload = JSON.parse(body); } catch { res.status(400).json({ error: "Invalid chat message." }); return; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) { res.status(400).json({ error: "Invalid chat message." }); return; }
  const text = typeof payload.text === "string" ? payload.text : "";
  const image = typeof payload.image === "string" ? payload.image : null;
  const gif = typeof payload.gif === "string" ? payload.gif : null;
  if (!text.trim() && !image && !gif) { res.status(400).json({ error: "Message is empty." }); return; }
  if (image && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(image)) { res.status(400).json({ error: "Invalid image." }); return; }
  if (image && image.length > 12 * 1024 * 1024) { res.status(400).json({ error: "Image is too large." }); return; }
  const [message] = await db.insert(directMessagesTable).values({ chatId: chat.id, senderId: me, body, imageUrl: null, gifUrl: null }).returning();
  await db.update(directChatsTable).set({ updatedAt: new Date(), lastMessageAt: new Date(), ...(chat.userOneId === me ? { deletedTwo: false } : { deletedOne: false }) }).where(eq(directChatsTable.id, chat.id));
  res.json({ message });
});

router.patch("/chat/:id/background", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me); if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  const bg = String(req.body?.background ?? "").trim().slice(0, 500);
  await db.update(directChatsTable).set(chat.userOneId === me ? { backgroundOne: bg } : { backgroundTwo: bg }).where(eq(directChatsTable.id, chat.id));
  res.json({ background: bg });
});

router.post("/chat/:id/unblock", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me); if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  const other = chat.userOneId === me ? chat.userTwoId : chat.userOneId;
  await db.delete(blockedUsersTable).where(and(eq(blockedUsersTable.blockerId, me), eq(blockedUsersTable.blockedId, other)));
  res.json({ blocked: false });
});

router.post("/chat/:id/block", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me); if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  const other = chat.userOneId === me ? chat.userTwoId : chat.userOneId;
  await db.insert(blockedUsersTable).values({ blockerId: me, blockedId: other }).onConflictDoNothing();
  res.json({ blocked: true });
});

router.delete("/chat/:id", async (req, res): Promise<void> => {
  const me = userId(req); if (!me) { res.status(401).json({ error: "Unauthorized" }); return; }
  const chat = await chatFor(Number(req.params.id), me); if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  await db.update(directChatsTable).set(chat.userOneId === me ? { deletedOne: true } : { deletedTwo: true }).where(eq(directChatsTable.id, chat.id));
  res.json({ success: true });
});

export default router;
