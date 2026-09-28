import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  emailAccountsTable,
  emailCampaignsTable,
  emailRecipientsTable,
  type EmailAccount,
} from "@workspace/db";
import {
  createEmailTransport,
  encryptEmailPassword,
  htmlToText,
  plainTextToHtml,
  sanitizeEmailHtml,
  verifyEmailAccount,
} from "../lib/email-pro";

const router: IRouter = Router();
const MAX_RECIPIENTS = 150;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS = new Set(["gmail", "outlook", "custom"]);

function getUserId(req: any): number | null {
  const raw = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(id) ? id : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function accountDto(account: EmailAccount) {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    displayName: account.displayName,
    replyTo: account.replyTo,
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    verifiedAt: account.verifiedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function campaignDto(campaign: typeof emailCampaignsTable.$inferSelect) {
  return {
    id: campaign.id,
    subject: campaign.subject,
    fromName: campaign.fromName,
    fromEmail: campaign.fromEmail,
    recipientCount: campaign.recipientCount,
    acceptedCount: campaign.acceptedCount,
    status: campaign.status,
    createdAt: campaign.createdAt.toISOString(),
  };
}

function recipientDto(recipient: typeof emailRecipientsTable.$inferSelect) {
  return {
    id: recipient.id,
    email: recipient.email,
    status: recipient.status,
    smtpMessageId: recipient.smtpMessageId,
    error: recipient.error,
    acceptedAt: recipient.acceptedAt?.toISOString() ?? null,
    createdAt: recipient.createdAt.toISOString(),
  };
}

function normalizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => stringValue(item).toLowerCase()).filter(Boolean)));
}

function containsHeaderBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

router.get("/email/accounts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(emailAccountsTable)
    .where(eq(emailAccountsTable.userId, userId))
    .orderBy(desc(emailAccountsTable.updatedAt));
  res.json({ data: rows.map(accountDto) });
});

router.post("/email/accounts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const requestedAccountId = req.body?.accountId == null || req.body?.accountId === ""
    ? null
    : Number(req.body.accountId);
  const provider = stringValue(req.body?.provider).toLowerCase();
  const host = stringValue(req.body?.host).toLowerCase();
  const username = stringValue(req.body?.username);
  const email = username.toLowerCase();
  const requestedDisplayName = stringValue(req.body?.displayName);
  const hasReplyTo = Object.prototype.hasOwnProperty.call(req.body ?? {}, "replyTo");
  const requestedReplyTo = stringValue(req.body?.replyTo).toLowerCase();
  const appPassword = typeof req.body?.appPassword === "string" ? req.body.appPassword : "";
  const port = Number(req.body?.port);
  const secure = req.body?.secure === true;

  if (requestedAccountId !== null && (!Number.isInteger(requestedAccountId) || requestedAccountId < 1)) {
    res.status(400).json({ error: "Invalid sending account." }); return;
  }
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: "Choose a supported email provider." }); return; }
  if (!username || !EMAIL_RE.test(email)) { res.status(400).json({ error: "Use the full mailbox address as the SMTP username." }); return; }
  if (requestedDisplayName && (requestedDisplayName.length > 120 || containsHeaderBreak(requestedDisplayName))) { res.status(400).json({ error: "Display name must be under 120 characters." }); return; }
  if (requestedReplyTo && !EMAIL_RE.test(requestedReplyTo)) { res.status(400).json({ error: "Reply-To must be a valid email address." }); return; }
  if (!host || host.length > 255) { res.status(400).json({ error: "Enter a valid SMTP host." }); return; }
  if (!Number.isInteger(port) || port < 1 || port > 65535) { res.status(400).json({ error: "SMTP port must be between 1 and 65535." }); return; }
  if (!username || !appPassword) { res.status(400).json({ error: "SMTP username and app password are required." }); return; }

  const encryptedPassword = encryptEmailPassword(appPassword);
  const [existing] = requestedAccountId
    ? await db.select().from(emailAccountsTable).where(and(
      eq(emailAccountsTable.id, requestedAccountId),
      eq(emailAccountsTable.userId, userId),
    ))
    : await db.select().from(emailAccountsTable).where(and(
      eq(emailAccountsTable.userId, userId),
      eq(emailAccountsTable.email, email),
      eq(emailAccountsTable.username, username),
      eq(emailAccountsTable.host, host),
    ));
  if (requestedAccountId && !existing) {
    res.status(404).json({ error: "Sending account not found." }); return;
  }
  const displayName = requestedDisplayName || existing?.displayName || "";
  const replyTo = hasReplyTo ? requestedReplyTo || null : existing?.replyTo ?? null;
  const now = new Date();
  const [account] = existing
    ? await db.update(emailAccountsTable).set({
      provider, email, displayName, replyTo, host, port, secure, username, encryptedPassword,
      verifiedAt: null, updatedAt: now,
    }).where(eq(emailAccountsTable.id, existing.id)).returning()
    : await db.insert(emailAccountsTable).values({
      userId, provider, email, displayName, replyTo, host, port, secure, username, encryptedPassword,
    }).returning();

  res.status(existing ? 200 : 201).json({
    account: accountDto(account),
    message: requestedAccountId ? "Sending account updated securely. Test the connection again before sending." : "Sending account saved securely. Test the connection before sending.",
  });
});

router.post("/email/accounts/:id/test", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const accountId = parseInt(String(req.params.id), 10);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!Number.isFinite(accountId)) { res.status(400).json({ error: "Invalid account." }); return; }
  const [account] = await db.select().from(emailAccountsTable).where(and(
    eq(emailAccountsTable.id, accountId),
    eq(emailAccountsTable.userId, userId),
  ));
  if (!account) { res.status(404).json({ error: "Sending account not found." }); return; }
  try {
    await verifyEmailAccount(account);
    const [updated] = await db.update(emailAccountsTable).set({ verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailAccountsTable.id, account.id)).returning();
    res.json({ ok: true, message: `Connection verified for ${updated.email}.` });
  } catch (error: any) {
    req.log?.warn?.({ accountId, err: error?.message }, "email account verification failed");
    await db.update(emailAccountsTable).set({ verifiedAt: null, updatedAt: new Date() })
      .where(eq(emailAccountsTable.id, account.id));
    res.status(400).json({ error: "Connection failed. Check the provider, SMTP settings, username, and app password." });
  }
});

router.delete("/email/accounts/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const accountId = parseInt(String(req.params.id), 10);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [deleted] = await db.delete(emailAccountsTable).where(and(
    eq(emailAccountsTable.id, accountId),
    eq(emailAccountsTable.userId, userId),
  )).returning({ id: emailAccountsTable.id });
  if (!deleted) { res.status(404).json({ error: "Sending account not found." }); return; }
  res.json({ success: true, message: "Sending account removed." });
});

router.post("/email/send", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const accountId = Number(req.body?.accountId);
  const requestedFromName = stringValue(req.body?.fromName);
  const requestedReplyTo = stringValue(req.body?.replyTo).toLowerCase();
  const recipients = normalizeRecipients(req.body?.recipients);
  const subject = stringValue(req.body?.subject);
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  const contentType = req.body?.contentType === "html" ? "html" : "text";
  if (!Number.isInteger(accountId)) { res.status(400).json({ error: "Choose a sending account." }); return; }
  if (!subject || subject.length > 998 || containsHeaderBreak(subject)) { res.status(400).json({ error: "Subject is required, must be under 998 characters, and cannot contain line breaks." }); return; }
  if (!body.trim() || body.length > 500_000) { res.status(400).json({ error: "Message body is required and must be under 500,000 characters." }); return; }
  if (recipients.length === 0) { res.status(400).json({ error: "Add at least one recipient." }); return; }
  if (recipients.length > MAX_RECIPIENTS) { res.status(400).json({ error: `You can send to up to ${MAX_RECIPIENTS} recipients at once.` }); return; }
  if (recipients.some((recipient) => !EMAIL_RE.test(recipient))) { res.status(400).json({ error: "Every recipient must be a valid email address." }); return; }
  if (requestedReplyTo && !EMAIL_RE.test(requestedReplyTo)) { res.status(400).json({ error: "Reply-To must be a valid email address." }); return; }

  const [account] = await db.select().from(emailAccountsTable).where(and(
    eq(emailAccountsTable.id, accountId),
    eq(emailAccountsTable.userId, userId),
  ));
  if (!account) { res.status(404).json({ error: "Sending account not found." }); return; }
  if (!account.verifiedAt) {
    res.status(409).json({ error: "Test this sending account before starting a campaign." }); return;
  }
  const fromName = requestedFromName;
  if (!fromName) { res.status(400).json({ error: "Display name is required for each campaign." }); return; }
  if (fromName.length > 120 || containsHeaderBreak(fromName)) { res.status(400).json({ error: "Display name must be under 120 characters." }); return; }

  const [campaign] = await db.insert(emailCampaignsTable).values({
    userId,
    accountId: account.id,
    fromName,
    fromEmail: account.email,
    replyTo: requestedReplyTo || account.replyTo || null,
    subject,
    body,
    contentType,
    recipientCount: recipients.length,
    status: "sending",
  }).returning();

  const recipientRows = await db.insert(emailRecipientsTable).values(
    recipients.map((email) => ({
      campaignId: campaign.id,
      email,
    })),
  ).returning();

  let acceptedCount = 0;
  const transport = createEmailTransport(account);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const row = recipientRows[cursor++];
      if (!row) return;
      try {
        const cleanHtml = contentType === "html" ? sanitizeEmailHtml(body) : `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">${plainTextToHtml(body)}</div>`;
        const info = await transport.sendMail({
          from: `"${fromName.replace(/"/g, "")}" <${account.email}>`,
          to: row.email,
          replyTo: requestedReplyTo || account.replyTo || undefined,
          subject,
          text: contentType === "html" ? htmlToText(body) : body,
          html: cleanHtml,
        });
        acceptedCount += 1;
        await db.update(emailRecipientsTable).set({
          status: "accepted", acceptedAt: new Date(), smtpMessageId: info.messageId ?? null,
        }).where(eq(emailRecipientsTable.id, row.id));
      } catch (error: any) {
        await db.update(emailRecipientsTable).set({
          status: "failed", error: String(error?.message ?? "SMTP send failed").slice(0, 500),
        }).where(eq(emailRecipientsTable.id, row.id));
        req.log?.warn?.({ campaignId: campaign.id, recipient: row.email, err: error?.message }, "campaign recipient send failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, recipientRows.length) }, () => worker()));

  const status = acceptedCount === recipients.length ? "accepted" : acceptedCount > 0 ? "partial" : "failed";
  const [completed] = await db.update(emailCampaignsTable).set({
    acceptedCount, status, completedAt: new Date(),
  }).where(eq(emailCampaignsTable.id, campaign.id)).returning();
  res.status(acceptedCount > 0 ? 201 : 502).json({
    ...(acceptedCount > 0 ? {} : { error: "No messages were accepted by your mail provider." }),
    campaign: campaignDto(completed),
  });
});

router.get("/email/sent", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const rows = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.userId, userId))
    .orderBy(desc(emailCampaignsTable.createdAt)).limit(limit + 1).offset(offset);
  res.json({ data: rows.slice(0, limit).map(campaignDto), hasMore: rows.length > limit });
});

router.get("/email/sent/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const campaignId = parseInt(String(req.params.id), 10);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!Number.isInteger(campaignId) || campaignId < 1) { res.status(400).json({ error: "Invalid campaign." }); return; }

  const [campaign] = await db.select().from(emailCampaignsTable).where(and(
    eq(emailCampaignsTable.id, campaignId),
    eq(emailCampaignsTable.userId, userId),
  ));
  if (!campaign) { res.status(404).json({ error: "Campaign not found." }); return; }

  const recipients = await db.select().from(emailRecipientsTable)
    .where(eq(emailRecipientsTable.campaignId, campaign.id))
    .orderBy(desc(emailRecipientsTable.createdAt), desc(emailRecipientsTable.id));

  res.json({
    campaign: {
      ...campaignDto(campaign),
      replyTo: campaign.replyTo,
      body: campaign.body,
      contentType: campaign.contentType,
      completedAt: campaign.completedAt?.toISOString() ?? null,
    },
    recipients: recipients.map(recipientDto),
  });
});

export default router;