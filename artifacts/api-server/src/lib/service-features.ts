import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";

export const SERVICE_FEATURES = [
  { key: "wallet_funding", label: "Wallet funding", description: "Fund a CipherPay wallet through the configured deposit provider." },
  { key: "transfers", label: "CipherPay transfers", description: "Send money between CipherPay users. External bank withdrawal is disabled." },
  { key: "data", label: "Data bundles", description: "Purchase live mobile data bundles through Socially." },
  { key: "sms", label: "SMS verification", description: "Purchase temporary verification numbers with SMS, Voice OTP or Flash Call where supported." },
  { key: "sms_esim", label: "International eSIM", description: "Purchase live data-only eSIM plans from SMSPool." },
  { key: "sms_rentals", label: "Long-term numbers", description: "Manage SMSPool rental numbers, messages and extensions." },
  { key: "temporary_email", label: "Temporary email", description: "Create and use temporary inboxes." },
  { key: "social_boost", label: "Social Boost", description: "Browse and order supported Socially social-media services." },
  { key: "social_accounts", label: "Social Accounts", description: "Buy available social media accounts by platform and country." },
  { key: "email_pro", label: "Email Pro", description: "Paid email sending and Email Pro access." },
  { key: "crypto", label: "Crypto", description: "Crypto wallet and supported crypto transactions." },
] as const;

export type ServiceFeatureKey = typeof SERVICE_FEATURES[number]["key"];

const SETTING_KEY = "service_feature_status";

export type ServiceFeatureStatus = Record<ServiceFeatureKey, boolean>;

export const DEFAULT_SERVICE_FEATURE_STATUS: ServiceFeatureStatus = Object.fromEntries(
  SERVICE_FEATURES.map(({ key }) => [key, true]),
) as ServiceFeatureStatus;

function normalize(value: unknown): ServiceFeatureStatus {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return SERVICE_FEATURES.reduce((result, { key }) => {
    result[key] = source[key] !== false;
    return result;
  }, { ...DEFAULT_SERVICE_FEATURE_STATUS } as ServiceFeatureStatus);
}

export async function getServiceFeatureStatus(): Promise<ServiceFeatureStatus> {
  const [setting] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_KEY))
    .limit(1);

  if (!setting) {
    return { ...DEFAULT_SERVICE_FEATURE_STATUS };
  }

  try {
    return normalize(JSON.parse(setting.value));
  } catch {
    return { ...DEFAULT_SERVICE_FEATURE_STATUS };
  }
}

export async function setServiceFeatureStatus(next: Partial<ServiceFeatureStatus>): Promise<ServiceFeatureStatus> {
  const current = await getServiceFeatureStatus();
  const merged = normalize({ ...current, ...next });
  const value = JSON.stringify(merged);

  const updated = await db.update(appSettingsTable)
    .set({ value, updatedAt: new Date() })
    .where(eq(appSettingsTable.key, SETTING_KEY))
    .returning({ key: appSettingsTable.key });

  if (!updated.length) {
    await db.insert(appSettingsTable).values({ key: SETTING_KEY, value });
  }

  return merged;
}

export async function isServiceFeatureEnabled(key: ServiceFeatureKey): Promise<boolean> {
  const status = await getServiceFeatureStatus();
  return status[key];
}
