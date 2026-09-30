import { ProxyAgent, setGlobalDispatcher } from "undici";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureAdminUser } from "./lib/admin-seed";
import { startElectricityTokenJob } from "./lib/electricity-token-job";
import { startTemporaryInboxRenewal } from "./lib/temporary-email";
import { isEmailConfigured, verifyEmailTransport } from "./lib/email";
import { startPayoutFundingPoller } from "./lib/payout-funding-poller";
import { renewDueEmailProSubscriptions } from "./lib/email-pro-subscription";
import { sendWeeklyUserEmails } from "./lib/user-email-job";

function normalizeProxyUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

const fixieUrl = normalizeProxyUrl(process.env["FIXIE_URL"]);
if (fixieUrl) {
  setGlobalDispatcher(new ProxyAgent(fixieUrl));
  logger.info("Outbound requests routed through proxy (stable egress IP)");
} else {
  logger.warn("FIXIE_URL not set — outbound requests use rotating egress IP (Flutterwave IP whitelist will not work)");
}

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const start = async () => {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_public_key text`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_user_code_unique ON users(user_code)`);
  await db.execute(sql`UPDATE users SET user_code = 'CP-' || upper(substr(md5(id::text), 1, 10)) WHERE user_code IS NULL`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS direct_chats (
    id serial PRIMARY KEY, user_one_id integer NOT NULL, user_two_id integer NOT NULL,
    background_one text, background_two text, deleted_one boolean NOT NULL DEFAULT false,
    deleted_two boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_one_id, user_two_id)
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS direct_messages (
    id serial PRIMARY KEY, chat_id integer NOT NULL, sender_id integer NOT NULL,
    body text, image_url text, gif_url text, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS blocked_users (
    id serial PRIMARY KEY, blocker_id integer NOT NULL, blocked_id integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(blocker_id, blocked_id)
  )`);


  app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  if (isEmailConfigured()) {
    void verifyEmailTransport()
      .then(() => logger.info("Email transport verified"))
      .catch((err: any) => logger.error({ err: err?.message }, "Email transport verification failed"));
  } else {
    logger.warn("Email transport unavailable — set EMAIL_USER and EMAIL_PASS");
  }
  void ensureAdminUser();
  startElectricityTokenJob();
  startTemporaryInboxRenewal();
  startPayoutFundingPoller();
  void renewDueEmailProSubscriptions();
  setInterval(() => void renewDueEmailProSubscriptions(), 60_000);
  if (process.env.MAILJET_RUN_TEST_ON_BOOT === "true") {
    const recipient = process.env.MAILJET_TEST_RECIPIENT?.trim();
    if (recipient) {
      void import("./lib/email").then(async ({ sendMail }) => {
        await sendMail(
          recipient,
          "CipherPay · Gmail sender test",
          "<p>This is a simple CipherPay Mailjet test using the Gmail sender address.</p>",
          "This is a simple CipherPay Mailjet test using the Gmail sender address."
        );
        logger.info({ recipient }, "Mailjet Gmail-sender test sent");
      }).catch((err: any) => logger.error({ err: err?.message }, "Mailjet Gmail-sender test failed"));
    }
  }
  setTimeout(() => void sendWeeklyUserEmails(), 30_000);
  setInterval(() => void sendWeeklyUserEmails(), 6 * 60 * 60 * 1000);
  });
};

void start().catch((err: any) => {
  logger.error({ err: err?.message }, "Server startup failed");
  process.exit(1);
});
