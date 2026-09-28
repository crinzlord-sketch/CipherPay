import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

let _transporter: Transporter | null = null;

function emailConfig() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT ?? (host ? 587 : 465));
  const secure = process.env.EMAIL_SECURE
    ? process.env.EMAIL_SECURE === "true"
    : port === 465;
  const replyTo = process.env.SUPPORT_REPLY_TO ?? user ?? "gglteam.2025@gmail.com";
  const from = process.env.EMAIL_FROM ?? `CipherPay <${user ?? "no-reply@example.com"}>`;
  return { user, pass, host, port, secure, replyTo, from };
}

function transporter(): Transporter {
  const config = emailConfig();
  if (!config.user || !config.pass) {
    throw new Error("Email not configured: EMAIL_USER and EMAIL_PASS must be set");
  }
  if (!_transporter) {
    _transporter = nodemailer.createTransport(config.host
      ? {
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user: config.user, pass: config.pass },
        }
      : {
          service: "gmail",
          auth: { user: config.user, pass: config.pass },
        });
  }
  return _transporter;
}

export function isEmailConfigured(): boolean {
  const { user, pass } = emailConfig();
  return !!(user && pass);
}

export async function verifyEmailTransport(): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error("Email not configured: EMAIL_USER and EMAIL_PASS must be set");
  }
  await transporter().verify();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandWrap(title: string, contentHtml: string, previewText: string): string {
  const { replyTo } = emailConfig();
  const safeTitle = escapeHtml(title);
  const safePreview = escapeHtml(previewText);
  const safeReplyTo = escapeHtml(replyTo);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fa;color:#17213b;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4f6fa;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td style="padding:0 8px 22px;">
                <div style="font-size:20px;line-height:28px;font-weight:700;letter-spacing:-.4px;color:#17213b;">
                  <span style="display:inline-block;width:28px;height:28px;margin-right:8px;border-radius:8px;background:#f4733a;color:#fff;font-size:13px;line-height:28px;text-align:center;vertical-align:middle;font-weight:800;">CP</span>
                  <span style="vertical-align:middle;">Cipher<span style="color:#f4733a;">Pay</span></span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e4e8f0;border-radius:16px;padding:40px 42px;">
                <div style="margin-bottom:14px;color:#f4733a;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">CipherPay account</div>
                <h1 style="margin:0 0 18px;color:#17213b;font-size:28px;line-height:36px;letter-spacing:-.7px;font-weight:700;">${safeTitle}</h1>
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 8px 0;color:#738099;font-size:12px;line-height:19px;">
                <p style="margin:0 0 8px;">This is an automated message from CipherPay. You can reply to this email if you need assistance.</p>
                <p style="margin:0;">Need help? Contact <a href="mailto:${safeReplyTo}" style="color:#5b3aa4;text-decoration:underline;">${safeReplyTo}</a><br>CipherPay, Nigeria</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendMail(to: string, subject: string, html: string, text?: string, replyToOverride?: string): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn({ to, subject }, "Email skipped — no email provider configured");
    throw new Error("Email service not configured. Please contact support.");
  }

  const plainText = text ?? html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Resend uses HTTPS, so it works from Render Free where outbound SMTP
  // ports are blocked. Keep SMTP as a fallback for local/legacy environments.
  if (process.env.RESEND_API_KEY) {
    try {
      const { replyTo, from } = emailConfig();
      const resendFromRaw = process.env.RESEND_FROM?.trim() || from;
      const resendFrom = resendFromRaw.includes("<")
        ? resendFromRaw
        : /@/.test(resendFromRaw)
          ? `CipherPay <${resendFromRaw}>`
          : resendFromRaw;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [to],
          subject,
          html,
          text: plainText,
          ...(replyToOverride ?? replyTo ? { reply_to: replyToOverride ?? replyTo } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? `Resend API returned HTTP ${response.status}`);
      }

      logger.info({ to, subject, messageId: payload?.id }, "email sent via Resend");
      return;
    } catch (e: any) {
      logger.error({ err: e?.message, to, subject }, "Resend email send failed");
      throw new Error(`Could not send email: ${e?.message ?? "unknown"}`);
    }
  }

  try {
    const { replyTo, from } = emailConfig();
    const info = await transporter().sendMail({
      from,
      replyTo: replyToOverride ?? replyTo,
      to, subject, html,
      text: plainText,
    });
    logger.info({ to, subject, messageId: info.messageId }, "email sent via SMTP");
  } catch (e: any) {
    logger.error({ err: e?.message, to, subject }, "email send failed");
    throw new Error(`Could not send email: ${e?.message ?? "unknown"}`);
  }
}

export async function sendOtpEmail(to: string, code: string, purpose: "verification" | "withdraw" | "password_reset" | "login"): Promise<void> {
  const map = {
    verification: { title: "Verify your email", subject: "Verify your CipherPay email", preview: "Your CipherPay verification code is ready.", intro: "Use the code below to verify the email address on your CipherPay account." },
    withdraw: { title: "Confirm your withdrawal", subject: "Confirm your CipherPay withdrawal", preview: "A withdrawal confirmation code was requested for your CipherPay account.", intro: "Use the code below to authorize this withdrawal from your CipherPay wallet." },
    password_reset: { title: "Reset your password", subject: "Reset your CipherPay password", preview: "Your CipherPay password reset code is ready.", intro: "Use the code below to continue resetting your CipherPay password." },
    login: { title: "Confirm your sign-in", subject: "Your CipherPay sign-in code", preview: "Your CipherPay sign-in code is ready.", intro: "Use the code below to finish signing in to your CipherPay account." },
  }[purpose];
  const safeCode = escapeHtml(code);
  const html = brandWrap(map.title, `
    <p style="margin:0 0 26px;color:#4e5c74;font-size:15px;line-height:24px;">${map.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      <tr><td align="center" style="padding:22px 16px;background:#fff7f2;border:1px solid #ffd9c6;border-radius:12px;">
        <div style="margin-bottom:9px;color:#a36a4c;font-size:10px;line-height:15px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Security code</div>
        <div style="color:#17213b;font-size:34px;line-height:42px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace;">${safeCode}</div>
        <div style="margin-top:9px;color:#738099;font-size:12px;line-height:18px;">Expires in 10 minutes</div>
      </td></tr>
    </table>
    <p style="margin:0;color:#738099;font-size:13px;line-height:21px;">For your security, never share this code. CipherPay support will never ask for it.</p>
  `, map.preview);
  await sendMail(to, map.subject, html, `${map.title}\n\n${map.intro}\n\nYour security code is ${code}.\n\nThis code expires in 10 minutes. Never share it with anyone.`);
}

export async function sendPasswordResetEmail(to: string, link: string, firstName: string): Promise<void> {
  const safeName = escapeHtml(firstName.trim() || "there");
  const safeLink = escapeHtml(link);
  const html = brandWrap("Reset your password", `
    <p style="margin:0 0 24px;color:#4e5c74;font-size:15px;line-height:24px;">Hi ${safeName}, we received a request to reset your CipherPay password.</p>
    <p style="margin:0 0 24px;color:#4e5c74;font-size:15px;line-height:24px;">Use the button below to choose a new password. This link is valid for 30 minutes.</p>
    <p style="margin:0 0 26px;text-align:center;">
      <a href="${safeLink}" style="display:inline-block;padding:13px 22px;border-radius:9px;background:#f4733a;color:#ffffff;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;">Reset password</a>
    </p>
    <p style="margin:0;color:#738099;font-size:12px;line-height:19px;word-break:break-word;">If the button does not work, copy this link into your browser:<br><a href="${safeLink}" style="color:#5b3aa4;text-decoration:underline;">${safeLink}</a></p>
    <p style="margin:22px 0 0;color:#738099;font-size:13px;line-height:21px;">If you did not request this, you can ignore this message. Your password will not change.</p>
  `, "Use the secure link to reset your CipherPay password.");
  await sendMail(to, "Reset your CipherPay password", html, `Hi ${firstName.trim() || "there"},\n\nWe received a request to reset your CipherPay password.\n\nReset your password: ${link}\n\nThis link is valid for 30 minutes. If you did not request this, you can ignore this message.`);
}

export async function sendUserNotificationEmail(to: string, title: string, body: string): Promise<void> {
  const safeBody = escapeHtml(body).replace(/\r?\n/g, "<br>");
  const html = brandWrap(title, `<p style="margin:0;color:#4e5c74;font-size:15px;line-height:25px;">${safeBody}</p>`, title);
  await sendMail(to, `CipherPay: ${title}`, html, `${title}\n\n${body}`);
}

// Sends an alert to the operator inbox whenever a user does something that
// needs admin attention (pending deposit, withdrawal request, KYC submission).
// Recipient is read from ADMIN_ALERT_EMAIL. When that optional setting is
// absent, use the configured sender inbox so operational alerts still arrive
// without requiring a second mailbox secret.
// Throws if the transport fails — callers must wrap in try/catch and treat it
// as best-effort so it never blocks the user-facing request.
export async function sendAdminAlertEmail(subject: string, body: string): Promise<void> {
  const recipient = process.env.ADMIN_ALERT_EMAIL ?? process.env.EMAIL_USER;
  if (!recipient) {
    logger.warn({ subject }, "Admin alert email skipped — no sender or admin recipient configured");
    return;
  }
  if (!isEmailConfigured()) {
    logger.warn({ subject }, "Admin alert email skipped — no email provider configured");
    return;
  }
  const safeBody = escapeHtml(body).replace(/\r?\n/g, "<br>");
  const html = brandWrap(subject, `<p style="margin:0;color:#4e5c74;font-size:15px;line-height:25px;">${safeBody}</p>`, subject);
  await sendMail(recipient, `CipherPay admin: ${subject}`, html, `${subject}\n\n${body}`);
}
