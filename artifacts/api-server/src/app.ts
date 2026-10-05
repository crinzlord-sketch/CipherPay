import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { flutterwaveWebhookHandler } from "./routes/webhooks";
import { verifyCallbackSignature } from "./lib/opay";
import { creditOpayFunding } from "./routes/wallet";
import { logger } from "./lib/logger";
import { verifyToken } from "./lib/auth";
import { verifyAdminToken } from "./lib/admin-auth";
import { isSessionActive } from "./lib/sessions";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LOGOS_DIR } from "./lib/logos";
import { getServiceFeatureStatus, type ServiceFeatureKey } from "./lib/service-features";


function cipherPayPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function createCipherPayPreviewPng(): Buffer {
  const width = 1200;
  const height = 630;
  const pixels = Buffer.alloc(width * height * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  };
  const bg = [12, 10, 18];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(x, y, bg[0], bg[1], bg[2]);

  const left = 470, top = 165, size = 300, radius = 82;
  const orange = (x: number, y: number) => {
    const cx = x < left + radius ? left + radius : x > left + size - radius ? left + size - radius : x;
    const cy = y < top + radius ? top + radius : y > top + size - radius ? top + size - radius : y;
    return Math.hypot(x - cx, y - cy) <= radius;
  };
  for (let y = top; y < top + size; y++) for (let x = left; x < left + size; x++) {
    if (!orange(x + 0.5, y + 0.5)) continue;
    const t = Math.max(0, Math.min(1, ((x - left) + (y - top)) / (size * 1.55)));
    setPixel(x, y, Math.round(255 - 14 * t), Math.round(157 - 51 * t), Math.round(82 - 25 * t));
  }

  const drawRoundLine = (x1: number, y1: number, x2: number, y2: number, radiusPx: number) => {
    const minX = Math.floor(Math.min(x1, x2) - radiusPx - 1);
    const maxX = Math.ceil(Math.max(x1, x2) + radiusPx + 1);
    const minY = Math.floor(Math.min(y1, y2) - radiusPx - 1);
    const maxY = Math.ceil(Math.max(y1, y2) + radiusPx + 1);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const qx = x1 + t * dx, qy = y1 + t * dy;
      if (Math.hypot(px - qx, py - qy) <= radiusPx) setPixel(x, y, 255, 255, 255);
    }
  };
  const angle = -Math.PI / 4;
  const line = (cx: number, cy: number, length: number) => {
    const dx = Math.cos(angle) * length / 2;
    const dy = Math.sin(angle) * length / 2;
    drawRoundLine(cx - dx, cy - dy, cx + dx, cy + dy, 9);
  };
  line(505, 236, 84);
  line(600, 315, 112);
  line(695, 394, 84);

  const raw = Buffer.alloc((height * (width * 4 + 1)));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    signature,
    cipherPayPngChunk("IHDR", ihdr),
    cipherPayPngChunk("IDAT", deflateSync(raw, { level: 9 })),
    cipherPayPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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

app.use(express.json({ limit: "20mb", verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));


// WhatsApp and other link-preview crawlers need a raster image rather than the
// SVG favicon. This endpoint renders the exact CipherPay mark as a PNG.
app.get("/api/brand/cipherpay-preview.png", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(createCipherPayPreviewPng());
});

// Flutterwave webhook (charge.completed / transfer.completed). Authenticity is a
// `verif-hash` header compare (not a body HMAC), so a parsed JSON body is fine.
app.post("/api/webhooks/flutterwave", flutterwaveWebhookHandler);

app.post("/api/webhooks/opay", async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body?.payload ?? {};
    const sha512 = String(req.body?.sha512 ?? "");
    const reference = String(payload.reference ?? "");
    if (!reference || !sha512 || !verifyCallbackSignature({
      amount: String(payload.amount ?? ""),
      currency: String(payload.currency ?? ""),
      reference,
      refunded: Boolean(payload.refunded),
      status: String(payload.status ?? ""),
      timestamp: String(payload.timestamp ?? ""),
      token: payload.token ?? "",
      transactionId: String(payload.transactionId ?? ""),
      sha512,
    })) {
      res.status(401).json({ error: "Invalid callback signature" });
      return;
    }

    const status = String(payload.status ?? "").toUpperCase();
    if (status === "SUCCESS") {
      await creditOpayFunding(reference, {
        amount: Number(payload.amount ?? 0) / 100,
        currency: String(payload.currency ?? "NGN"),
        orderNo: String(payload.transactionId ?? ""),
      });
    } else if (["FAIL", "CLOSE"].includes(status)) {
      const { db, transactionsTable } = await import("@workspace/db");
      const { and, eq } = await import("drizzle-orm");
      await db.update(transactionsTable).set({ status: "failed" })
        .where(and(eq(transactionsTable.reference, reference), eq(transactionsTable.type, "fund"), eq(transactionsTable.status, "pending")));
    }
    res.json({ code: "00000", message: "SUCCESS" });
  } catch (error: any) {
    req.log?.warn?.({ err: error?.message }, "OPay webhook processing failed");
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

app.get("/api/opay/return", (req: Request, res: Response): void => {
  const reference = String(req.query.reference ?? "");
  const target = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, "") || "/";
  const destination = reference ? `${target}/fund?opay_reference=${encodeURIComponent(reference)}` : `${target}/fund`;
  res.redirect(302, destination);
});

// Hosted-checkout return page. Flutterwave redirects the in-app WebView here
// after payment with ?status=&tx_ref=&transaction_id=. The mobile client detects
// this URL, closes the WebView and calls /wallet/fund/verify. The page itself is
// just a friendly placeholder in case it's ever opened in a normal browser.
app.get("/api/checkout/callback", (req: Request, res: Response): void => {
  const status = String(req.query.status ?? "");
  res.setHeader("Cache-Control", "no-store");
  const successful = status === "successful" || status === "completed";
  const cancelled = ["cancelled", "canceled", "failed", "error"].includes(status.toLowerCase());
  const title = successful ? "Payment complete" : cancelled ? "Payment cancelled" : "Payment not completed";
  const message = successful ? "Returning you to the CipherPay app…" : cancelled ? "The card payment was cancelled. You were not charged." : "The card payment was not completed. Returning you to CipherPay…";
  res.status(200).send(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>CipherPay</title></head>` +
      `<body style="font-family:system-ui;text-align:center;padding:48px;color:#1f2937">` +
      `<h2 style="color:#7c3aed">${title}</h2><p>${message}</p>` +
      `<script>try{window.parent.postMessage({type:"cipherpay:checkout-callback",status:"${status.replace(/"/g,"")}",tx_ref:"${String(req.query.tx_ref ?? "").replace(/"/g,"")}",transaction_id:"${String(req.query.transaction_id ?? "").replace(/"/g,"")}"}, "*")}catch(e){}</script>` +
      `</body></html>`,
  );
});

// Authenticated KYC file streaming. Files are NOT publicly accessible:
// the requester must present a valid user JWT (owns the file, encoded as
// "u<userId>-..." filename prefix) OR an admin JWT, via ?token=<jwt>.
import path from "path";
import fs from "fs";
import { deflateSync } from "node:zlib";
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
const serviceRouteFeature = (path: string): ServiceFeatureKey | null => {
  if (path === "/wallet/transfer" || path.startsWith("/wallet/transfer/")) return "transfers";
  if (path === "/wallet/withdraw" || path.startsWith("/wallet/withdraw/")) return "transfers";
  if (path.startsWith("/wallet/fund") || path.startsWith("/wallet/deposit")) return "wallet_funding";
  if (path.startsWith("/airtime")) return "airtime";
  if (path.startsWith("/data")) return "data";
  if (path.startsWith("/bills")) return "bills";
  if (path.startsWith("/sms/esim")) return "sms_esim";
  if (path.startsWith("/sms/rentals")) return "sms_rentals";
  if (path.startsWith("/sms")) return "sms";
  if (path.startsWith("/temporary-email")) return "temporary_email";
  if (path.startsWith("/email")) return "email_pro";
  if (path.startsWith("/social-boost")) return "social_boost";
  if (path.startsWith("/social-accounts")) return "social_accounts";
  if (path.startsWith("/crypto")) return "crypto";
  return null;
};

app.get("/api/service-features", async (_req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const status = await getServiceFeatureStatus();
  res.json({ data: status });
});

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

app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  const feature = serviceRouteFeature(req.path);
  if (!feature) {
    next();
    return;
  }
  try {
    const status = await getServiceFeatureStatus();
    if (status[feature]) {
      next();
      return;
    }

    // Admin accounts always bypass service maintenance/feature toggles.
    // Service controls are for normal users only; an admin must retain full
    // access so they can test and operate a service even while it is disabled
    // for everyone else.
    const userId = Number(req.headers["x-user-id"]);
    if (Number.isFinite(userId) && userId > 0) {
      const [account] = await db.select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (account?.isAdmin) {
        next();
        return;
      }
    }

    res.status(503).json({
      error: "This service is temporarily unavailable while we carry out scheduled maintenance. Your account and funds remain safe. Please try again shortly.",
      code: "SERVICE_MAINTENANCE",
      feature,
    });
  } catch (error: any) {
    req.log?.warn?.({ err: error?.message, feature }, "Service availability check failed");
    next();
  }
});

app.use("/api", router);

export default app;
