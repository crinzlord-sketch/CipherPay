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
