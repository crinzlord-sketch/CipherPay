import { ProxyAgent, setGlobalDispatcher } from "undici";
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
  setTimeout(async () => {
    if (process.env["MAILJET_RUN_TEST_ON_BOOT"] !== "true") return;
    try {
      const recipient = process.env["MAILJET_TEST_RECIPIENT"]?.trim();
      if (!recipient) throw new Error("MAILJET_TEST_RECIPIENT is not set");
      const { sendMail } = await import("./lib/email");
      await sendMail({
        from: process.env["MAILJET_FROM"] || process.env["EMAIL_FROM"] || "support@cipherpay.it.com",
        to: recipient,
        subject: "CipherPay test",
        text: "This is a simple CipherPay Mailjet delivery test.",
        html: "<p>This is a simple CipherPay Mailjet delivery test.</p>",
      });
      logger.info({ recipient }, "Mailjet simple test sent");
    } catch (err: any) {
      logger.error({ err: err?.message }, "Mailjet simple test failed");
    }
  }, 5_000);
  setTimeout(() => void sendWeeklyUserEmails(), 30_000);
  setInterval(() => void sendWeeklyUserEmails(), 6 * 60 * 60 * 1000);
});
