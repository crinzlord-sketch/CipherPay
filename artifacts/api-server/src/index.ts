import { ProxyAgent, setGlobalDispatcher } from "undici";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureAdminUser } from "./lib/admin-seed";
import { startElectricityTokenJob } from "./lib/electricity-token-job";
import { startTemporaryInboxRenewal } from "./lib/temporary-email";
import { isEmailConfigured, verifyEmailTransport, sendMail } from "./lib/email";
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
      .then(async () => {
        logger.info("Email transport verified");
        if (process.env.MAILJET_RUN_TEST_ON_BOOT === "true") {
          const recipient = String(process.env.MAILJET_TEST_RECIPIENT ?? "eteowoudo@gmail.com").trim();
          if (recipient) {
            try {
              await sendMail(
                recipient,
                "CipherPay · Mailjet delivery test",
                "<div style=\"font-family:Arial,sans-serif;padding:24px;color:#1f2937\"><h2>CipherPay Mailjet test</h2><p>This is a live delivery test from CipherPay using the Mailjet transport.</p></div>",
                "This is a live delivery test from CipherPay using the Mailjet transport.",
              );
              logger.info({ recipient }, "Mailjet delivery test sent");
            } catch (err: any) {
              logger.error({ err: err?.message, recipient }, "Mailjet delivery test failed");
            }
          }
        }
      })
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
  setTimeout(() => void sendWeeklyUserEmails(), 30_000);
  setInterval(() => void sendWeeklyUserEmails(), 6 * 60 * 60 * 1000);
});
