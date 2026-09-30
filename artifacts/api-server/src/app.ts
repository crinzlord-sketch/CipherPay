import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { flutterwaveWebhookHandler } from "./routes/webhooks";
import { logger } from "./lib/logger";
import { verifyToken } from "./lib/auth";
import { verifyAdminToken } from "./lib/admin-auth";
import { isSessionActive } from "./lib/sessions";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LOGOS_DIR } from "./lib/logos";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Flutterwave webhook (charge.completed / transfer.completed). Authenticity is a
// `verif-hash` header compare (not a body HMAC), so a parsed JSON body is fine.
app.post("/api/webhooks/flutterwave", flutterwaveWebhookHandler);

// Hosted-checkout return page. Flutterwave redirects the in-app WebView here
// after payment with ?status=&tx_ref=&transaction_id=. The mobile client detects
// this URL, closes the WebView and calls /wallet/fund/verify. The page itself is
// just a friendly placeholder in case it's ever opened in a normal browser.
app.get("/api/checkout/callback", (req: Request, res: Response): void => {
  const status = String(req.query.status ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>CipherPay</title></head>` +
      `<body style="font-family:system-ui;text-align:center;padding:48px;color:#1f2937">` +
      `<h2 style="color:#7c3aed">Payment ${status === "successful" || status === "completed" ? "complete" : "received"}</h2>` +
      `<p>Returning you to the CipherPay app…</p></body></html>`,
  );
});

// Authenticated KYC file streaming. Files are NOT publicly accessible:
// the requester must present a valid user JWT (owns the file, encoded as
// "u<userId>-..." filename prefix) OR an admin JWT, via ?token=<jwt>.
import path from "path";
import fs from "fs";
// Avatar files are publicly served by filename (no token required). The URL is
// stored on the user row and shown anywhere the user appears, so we treat it
// like any other public asset. Filename format is `u<id>-<ts>.<ext>`.
app.get("/api/uploads/chat/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  if (!/^c\d+-\d+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) { res.status(400).json({ error: "Invalid filename" }); return; }
  const filePath = path.resolve(process.cwd(), "uploads", "chat", filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(filePath);
});

app.get("/api/uploads/avatar/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  if (!/^u\d+-\d+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  const filePath = path.resolve(process.cwd(), "uploads", "avatar", filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(filePath);
});

// Advert images are public assets shown to all users (like avatars).
app.get("/api/uploads/ads/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  if (!/^a\d+-\d+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  const filePath = path.resolve(process.cwd(), "uploads", "ads", filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(filePath);
});

// VAS brand logos (mobile networks + bill providers). Public static assets, no
// token required. Filename is validated to prevent path traversal.
app.get("/api/assets/logos/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  if (!/^[A-Za-z0-9]+\.(png|jpe?g|webp)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  const filePath = path.join(LOGOS_DIR, filename);
  if (!filePath.startsWith(LOGOS_DIR + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(filePath);
});

// Support chat image attachments — publicly served (images are inside a chat
// session the user already owns; auth is implicit via the chat session).
app.get("/api/uploads/support/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  if (!/^s\d+-\d+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  const filePath = path.resolve(process.cwd(), "uploads", "support", filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(filePath);
});

app.get("/api/uploads/kyc/:filename", (req: Request, res: Response): void => {
  const filename = String(req.params.filename ?? "");
  // Reject path-traversal / unexpected names
  if (!/^u\d+-(front|back|selfie)-\d+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const token = String(req.query.token ?? req.headers.authorization?.toString().replace(/^Bearer\s+/i, "") ?? "");
  if (!token) { res.status(401).json({ error: "Missing token" }); return; }
  const userPayload = verifyToken(token);
  const adminPayload = verifyAdminToken(token);
  const ownerId = parseInt(filename.match(/^u(\d+)-/)?.[1] ?? "0", 10);
  const isOwner = userPayload?.userId === ownerId;
  const isAdmin = !!adminPayload;
  if (!isOwner && !isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  const filePath = path.resolve(process.cwd(), "uploads", "kyc", filename);
  if (!filePath.startsWith(path.resolve(process.cwd(), "uploads", "kyc") + path.sep)) {
    res.status(400).json({ error: "Invalid path" }); return;
  }
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(filePath);
});

// SECURITY: Derive the authenticated `x-user-id` from the verified JWT.
// Routes read userId from this header, but the *client* must never be trusted to
// set it (that would be trivial IDOR). The Bearer token is the single source of
// truth: we verify it, then OVERWRITE x-user-id with the verified id. Any
// x-user-id a client tries to supply is validated against the token and rejected
// on mismatch. Requests without a token are left untouched so public endpoints
// (login, register, forgot/reset password, OTP) still work; those routes that
// require auth will then see no x-user-id and 401 on their own.
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const rawHeader = req.headers["x-user-id"];
  const claimed = rawHeader === undefined || rawHeader === ""
    ? null
    : Array.isArray(rawHeader) ? rawHeader[0]! : rawHeader;

  if (!token) {
    // No token: a client must not pre-set an identity header.
    if (claimed !== null) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    return next();
  }

  // Accept either a user JWT or an admin JWT (admin endpoints share the proxy).
  const userPayload = verifyToken(token);
  const adminPayload = verifyAdminToken(token);
  const tokenUserId = userPayload?.userId ?? adminPayload?.userId;
  if (tokenUserId === undefined) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (claimed !== null) {
    const claimedId = parseInt(claimed, 10);
    if (!Number.isFinite(claimedId) || claimedId !== tokenUserId) {
      req.log?.warn({ tokenUserId, claimed, path: req.path }, "x-user-id spoof rejected");
      res.status(403).json({ error: "Identity mismatch" });
      return;
    }
  }

  // A deleted account must invalidate even older JWTs or sessions that may
  // still exist in the sessions table. Checking the user row here also covers
  // direct database deletion, not just deletion through the admin console.
  if (userPayload) {
    const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userPayload.userId)).limit(1);
    if (!existingUser) {
      res.status(401).json({ error: "This account no longer exists.", code: "ACCOUNT_DELETED" });
      return;
    }
  }

  // Device-session gate: if this is a user JWT carrying a session id, the
  // session must still be active. Revoking a device (or "log out everywhere")
  // flips the session's `revoked` flag, which invalidates its token here even
  // though the JWT itself is otherwise still valid. Older tokens without a sid
  // are grandfathered through.
  if (userPayload?.sid !== undefined) {
    const active = await isSessionActive(userPayload.sid);
    if (!active) {
      res.status(401).json({ error: "This device was signed out. Please sign in again.", code: "SESSION_REVOKED" });
      return;
    }
    req.headers["x-session-id"] = String(userPayload.sid);
  }

  // Bind the verified identity so downstream routes can trust x-user-id.
  req.headers["x-user-id"] = String(tokenUserId);
  next();
});

app.use("/api", router);

export default app;
