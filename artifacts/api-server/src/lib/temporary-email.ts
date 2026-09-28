import { and, eq, lte } from "drizzle-orm";
import { db, temporaryInboxesTable } from "@workspace/db";
import { logger } from "./logger";

const MAILBOX_API = "https://mailboxtemp.com";
const RENEWAL_WINDOW_MS = 15 * 60 * 1000;

type ProviderInbox = {
  ok: boolean;
  address?: string;
  inboxId?: string;
  expires?: string;
  expires_at?: string;
  error?: string;
};

async function providerRequest<T extends ProviderInbox>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${MAILBOX_API}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `Temporary email provider returned HTTP ${response.status}.`);
  }
  return body;
}

function providerExpiry(body: ProviderInbox): Date | null {
  const raw = body.expires ?? body.expires_at;
  if (!raw) return null;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

export async function createProviderInbox(): Promise<{ address: string; inboxId: string; expiresAt: Date }> {
  const created = await providerRequest<ProviderInbox>("/api/inbox/generate", { method: "POST" });
  const expiresAt = providerExpiry(created);
  if (!created.address || !created.inboxId || !expiresAt) throw new Error("Temporary email provider returned an incomplete inbox.");
  return { address: created.address, inboxId: created.inboxId, expiresAt };
}

async function renewOne(id: number, address: string): Promise<void> {
  try {
    await providerRequest(`/api/inbox/${encodeURIComponent(address)}/extend`, { method: "POST" });
    const metadata = await providerRequest<ProviderInbox>(`/api/inbox/${encodeURIComponent(address)}`);
    const expiresAt = providerExpiry(metadata);
    if (!expiresAt) throw new Error("Temporary email provider returned no expiry.");
    await db.update(temporaryInboxesTable).set({ expiresAt, status: "active" }).where(eq(temporaryInboxesTable.id, id));
  } catch (error: any) {
    await db.update(temporaryInboxesTable).set({ status: "unavailable" }).where(eq(temporaryInboxesTable.id, id)).catch(() => {});
    logger.warn({ id, err: error?.message }, "temporary inbox renewal failed");
  }
}

export async function renewDueTemporaryInboxes(): Promise<void> {
  const before = new Date(Date.now() + RENEWAL_WINDOW_MS);
  const due = await db.select().from(temporaryInboxesTable)
    .where(and(eq(temporaryInboxesTable.status, "active"), lte(temporaryInboxesTable.expiresAt, before)));
  await Promise.all(due.map((inbox) => renewOne(inbox.id, inbox.address)));
}

export function startTemporaryInboxRenewal(): NodeJS.Timeout {
  void renewDueTemporaryInboxes().catch((error: any) => logger.warn({ err: error?.message }, "temporary inbox renewal sweep failed"));
  return setInterval(() => {
    void renewDueTemporaryInboxes().catch((error: any) => logger.warn({ err: error?.message }, "temporary inbox renewal sweep failed"));
  }, 5 * 60 * 1000);
}