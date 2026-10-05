import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";

const router = Router();
const SCOPES = "https://www.googleapis.com/auth/gmail.send";
const CALLBACK_PATH = "/api/admin/google-email/callback";

function secret() {
  return process.env.SESSION_SECRET || "";
}

function makeState() {
  const payload = JSON.stringify({ iat: Date.now() });
  const body = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function validState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig || !secret()) return false;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return Number.isFinite(parsed.iat) && Date.now() - parsed.iat < 10 * 60 * 1000;
}

router.get("/admin/google-email/start", (_req: Request, res: Response): void => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const sender = process.env.GMAIL_SENDER_EMAIL;
  if (!clientId || !process.env.GMAIL_CLIENT_SECRET || !sender) {
    res.status(503).json({ error: "Gmail API OAuth is not configured yet." });
    return;
  }
  const redirectUri = `${process.env.PUBLIC_API_URL || "https://cipherpay-api.onrender.com"}${CALLBACK_PATH}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "select_account",
    scope: SCOPES,
    state: makeState(),
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/admin/google-email/callback", async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !validState(state)) {
    res.status(400).send("Invalid or expired Google authorization request.");
    return;
  }
  try {
    const clientId = String(process.env.GMAIL_CLIENT_ID || "");
    const clientSecret = String(process.env.GMAIL_CLIENT_SECRET || "");
    const redirectUri = `${process.env.PUBLIC_API_URL || "https://cipherpay-api.onrender.com"}${CALLBACK_PATH}`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.refresh_token || !tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || "Google did not return the required OAuth tokens.");
    }

    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json().catch(() => ({}));
    const email = String(profile.emailAddress || "").trim().toLowerCase();
    const expected = String(process.env.GMAIL_SENDER_EMAIL || "").trim().toLowerCase();
    if (!email || email !== expected) {
      res.status(403).send("The authorized Google account does not match GMAIL_SENDER_EMAIL.");
      return;
    }

    res.status(200).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>CipherPay Gmail Connected</title></head><body style="font-family:system-ui;max-width:720px;margin:40px auto;padding:20px"><h2>Google authorization successful</h2><p>Add this refresh token to your Render API environment as <b>GMAIL_REFRESH_TOKEN</b>. Keep it private.</p><textarea readonly style="width:100%;min-height:110px;font-family:monospace">${String(tokens.refresh_token).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</textarea><p>After saving the variable and deploying, CipherPay will send through Gmail API over HTTPS.</p></body></html>`);
  } catch (error: any) {
    res.status(502).send(`Google authorization failed: ${String(error?.message || "unknown error").replace(/[<>]/g, "")}`);
  }
});

export default router;
