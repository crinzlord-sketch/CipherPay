const PAYSTACK_BASE = "https://api.paystack.co";

function getKey(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return k;
}

async function paystackRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string } & Record<string, unknown>;
  if (!res.ok || body.status === false) {
    let msg = body.message ?? `Paystack request failed (${res.status})`;
    if (typeof msg === "string" && /test mode.*daily limit/i.test(msg)) {
      msg = "Paystack test mode daily limit (3 bank lookups) reached. Try again in 24h, use Paystack test account 0000000000, or switch to a live Paystack secret key for unlimited resolves.";
    }
    throw new Error(msg);
  }
  return body as T;
}

export interface PaystackBank {
  name: string;
  slug: string;
  code: string;
  longcode?: string;
  type?: string;
  active?: boolean;
}

export async function listPaystackBanks(): Promise<PaystackBank[]> {
  const body = await paystackRequest<{ data: PaystackBank[] }>("/bank?country=nigeria&perPage=200");
  return (body.data ?? []).filter((b) => b.active !== false);
}

export interface ResolvedAccount {
  account_number: string;
  account_name: string;
  bank_id?: number;
}

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
  const body = await paystackRequest<{ data: ResolvedAccount }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  return body.data;
}

export interface InitTxResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export async function initializeTransaction(params: {
  amount: number;
  email: string;
  reference: string;
  callback_url?: string;
  channels?: string[];
  metadata?: Record<string, unknown>;
}): Promise<InitTxResult> {
  const body = await paystackRequest<{ data: InitTxResult }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      amount: Math.round(params.amount * 100),
      email: params.email,
      reference: params.reference,
      callback_url: params.callback_url,
      channels: params.channels,
      metadata: params.metadata,
    }),
  });
  return body.data;
}

export interface VerifyTxResult {
  status: "success" | "failed" | "abandoned" | "pending" | string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  paid_at?: string;
  customer?: { email?: string };
}

export async function verifyTransaction(reference: string): Promise<VerifyTxResult> {
  const body = await paystackRequest<{ data: VerifyTxResult }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return body.data;
}

// ── TRANSFERS (real bank payouts) ─────────────────────────────────────────
export interface TransferRecipientResult {
  recipient_code: string;
  type: string;
  name: string;
  details: { account_number: string; bank_code: string; bank_name?: string };
}

export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<TransferRecipientResult> {
  const body = await paystackRequest<{ data: TransferRecipientResult }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: "nuban",
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "NGN",
    }),
  });
  return body.data;
}

export interface InitiateTransferResult {
  // Paystack returns "success" (instant) | "pending" | "otp" (requires OTP finalize) | "queued"
  status: "success" | "pending" | "otp" | "queued" | string;
  transfer_code: string;
  reference: string;
  amount: number; // in kobo
}

export async function initiateTransfer(params: {
  amount: number; // NGN
  recipientCode: string;
  reference: string;
  reason?: string;
}): Promise<InitiateTransferResult> {
  const body = await paystackRequest<{ data: InitiateTransferResult }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(params.amount * 100),
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason ?? "CipherPay withdrawal",
    }),
  });
  return body.data;
}

// For manual reconciliation: GET /transfer/verify/:reference returns current status.
export async function verifyTransfer(reference: string): Promise<{ status: string; transfer_code: string; reference: string }> {
  const body = await paystackRequest<{ data: { status: string; transfer_code: string; reference: string } }>(
    `/transfer/verify/${encodeURIComponent(reference)}`
  );
  return body.data;
}
