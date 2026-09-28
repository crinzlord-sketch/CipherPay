const BASE = "https://api.flutterwave.com/v3";

function secretKey(): string {
  const k = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!k) throw new Error("FLUTTERWAVE_SECRET_KEY not set");
  return k;
}

// Unique idempotent reference for a bill payment. Flutterwave dedupes on this.
export function flwReference(suffix?: string): string {
  const stamp = Date.now().toString(36);
  const tail = suffix ?? Math.random().toString(36).slice(2, 8);
  return `CP-${stamp}-${tail}`.slice(0, 48);
}

export async function flwGet<T = any>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function flwPost<T = any>(path: string, payload: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

// Flutterwave airtime type constant — all NG networks share biller_name "AIRTIME";
// the network is auto-detected from the phone number. No per-network catalog fetch needed.

// Electricity is amount-based (variable). Separate item codes for prepaid vs postpaid.
export const FLW_ELECTRICITY: Record<string, { biller: string; prepaid: string; postpaid: string }> = {
  ekedc:  { biller: "BIL112", prepaid: "UB157", postpaid: "UB158" },
  ikedc:  { biller: "BIL113", prepaid: "UB159", postpaid: "UB160" },
  aedc:   { biller: "BIL204", prepaid: "UB584", postpaid: "UB585" },
  phedc:  { biller: "BIL116", prepaid: "UB633", postpaid: "UB165" },
  kedco:  { biller: "BIL120", prepaid: "UB169", postpaid: "UB170" },
  enedco: { biller: "BIL115", prepaid: "UB163", postpaid: "UB164" },
  ibedc:  { biller: "BIL114", prepaid: "UB161", postpaid: "UB162" },
  jedc:   { biller: "BIL215", prepaid: "UB676", postpaid: "UB677" },
  kaedc:  { biller: "BIL119", prepaid: "UB602", postpaid: "UB603" },
  yedc:   { biller: "BIL118", prepaid: "UB168", postpaid: "UB168" },
  bedc:   { biller: "BIL117", prepaid: "UB167", postpaid: "UB166" },
};

export interface FlwResult {
  success: boolean;
  message: string;
  reference?: string;
  flwRef?: string;
  raw: any;
}

function parsePayResult(status: number, body: any, reference: string, acceptPending = false): FlwResult {
  // Flutterwave returns { status: "success"|"pending", message, data: {...} } on acceptance.
  // Electricity/utility bills normally come back as "pending" (async delivery via SMS/meter).
  const bodyStatus = body?.status;
  const ok = status >= 200 && status < 300 && (bodyStatus === "success" || (acceptPending && bodyStatus === "pending"));
  return {
    success: ok,
    message: body?.message ?? (ok ? "Payment accepted" : "Payment failed"),
    reference: body?.data?.reference ?? reference,
    flwRef: body?.data?.flw_ref ?? body?.data?.batch_reference,
    raw: body,
  };
}

// ── Airtime ────────────────────────────────────────────────────────────────
// Flutterwave auto-detects the carrier from the phone number when type = "AIRTIME".
export async function buyAirtime(params: { phone: string; amount: number; reference: string; network: string }): Promise<FlwResult> {
  const { status, body } = await flwPost("/bills", {
    country: "NG",
    customer: params.phone,
    amount: params.amount,
    type: "AIRTIME",
    reference: params.reference,
    recurrence: "ONCE",
  });
  return parsePayResult(status, body, params.reference);
}

// ── Data bundles (live catalog; NG only) ─────────────────────────────────────
export interface FlwDataPlan {
  itemCode: string;
  billerCode: string;
  billerName: string;  // Flutterwave biller_name — used as `type` in POST /v3/bills
  name: string;
  amount: number;
  network: string | null;
}

function dataNetworkFromBiller(billerName: string): string | null {
  const h = billerName.toLowerCase();
  if (h.startsWith("mtn")) return "mtn";
  if (h.startsWith("airtel")) return "airtel";
  if (h.startsWith("glo")) return "glo";
  if (h.startsWith("9mobile") || h.startsWith("9 mobile") || h.startsWith("etisalat")) return "9mobile";
  return null;
}

// GET /bill-categories?data_bundle=1 returns the data plans. This is a public
// catalog read (no IP whitelisting required); only the pay step hits /bills.
export async function dataPlans(): Promise<FlwDataPlan[]> {
  const { status, body } = await flwGet<any>("/bill-categories?data_bundle=1&country=NG");
  if (status < 200 || status >= 300 || body?.status === "error") {
    throw new Error(body?.message || `Flutterwave data plans failed (HTTP ${status})`);
  }
  const data: any[] = body?.data ?? [];
  return data
    .filter((d) => (d?.country ?? "NG") === "NG" && d?.item_code)
    .map((d) => ({
      itemCode: String(d.item_code),
      billerCode: String(d?.biller_code ?? ""),
      billerName: String(d?.biller_name ?? d?.name ?? ""),
      name: String(d?.name ?? d?.biller_name ?? ""),
      amount: Number(d?.amount ?? 0),
      network: dataNetworkFromBiller(String(d?.biller_name ?? "")),
    }));
}

// Pay for a data bundle. `type` must be the plan's biller_name from the catalog
// (Flutterwave maps this to the specific plan); item_code is included for disambiguation.
export async function buyData(params: { phone: string; amount: number; itemCode: string; billerName: string; reference: string }): Promise<FlwResult> {
  const { status, body } = await flwPost("/bills", {
    country: "NG",
    customer: params.phone,
    amount: params.amount,
    type: params.billerName,
    reference: params.reference,
    recurrence: "ONCE",
    item_code: params.itemCode,
  });
  return parsePayResult(status, body, params.reference);
}

// ── Bill validation (electricity meter / smartcard lookup) ───────────────────
export interface FlwValidateResult {
  name: string | null;
  address: string | null;
  raw: any;
}

export async function validateBill(params: { biller: string; item: string; customer: string }): Promise<FlwValidateResult> {
  const { status, body } = await flwGet<any>(
    `/bill-items/${encodeURIComponent(params.item)}/validate?code=${encodeURIComponent(params.biller)}&customer=${encodeURIComponent(params.customer)}`,
  );
  // Distinguish a provider/auth/transport failure (throw -> 502 upstream) from a
  // genuine "no such customer" (resolves with name=null -> 400 upstream). Without
  // this, an IP-whitelist 400 or auth 401 would masquerade as "meter not found".
  if (status < 200 || status >= 300 || body?.status === "error") {
    throw new Error(body?.message || `Flutterwave validation failed (HTTP ${status})`);
  }
  const data = body?.data ?? {};
  return {
    name: data?.name ?? data?.customer ?? null,
    address: data?.address ?? null,
    raw: body,
  };
}

// ── Electricity catalog (live; cached in the route layer) ────────────────────
// GET /bill-categories?electricity=1 returns all disco billers.
// billerName (biller_name from catalog) is what POST /v3/bills expects as `type`.
export interface FlwElecPlan {
  itemCode: string;
  billerCode: string;
  billerName: string;  // Used as `type` in POST /v3/bills — NOT the biller code
  name: string;
}

export async function electricityPlans(): Promise<FlwElecPlan[]> {
  const { status, body } = await flwGet<any>("/bill-categories?electricity=1&country=NG");
  if (status < 200 || status >= 300 || body?.status === "error") {
    throw new Error(body?.message || `Flutterwave electricity catalog failed (HTTP ${status})`);
  }
  const data: any[] = body?.data ?? [];
  return data
    .filter((d) => d?.item_code)
    .map((d) => ({
      itemCode: String(d.item_code),
      billerCode: String(d?.biller_code ?? ""),
      billerName: String(d?.biller_name ?? d?.name ?? ""),
      name: String(d?.name ?? d?.biller_name ?? ""),
    }));
}

// ── Bill payment (electricity, amount-based) ─────────────────────────────────
// Flutterwave POST /v3/bills requires:
//   type      = billerName from the live catalog (e.g. "EKEDC Prepaid") — NOT biller/item codes
//   item_code = item code from the catalog (e.g. "UB157")
export async function payBill(params: { billerName: string; item: string; customer: string; amount: number; reference: string }): Promise<FlwResult> {
  const { status, body } = await flwPost("/bills", {
    country: "NG",
    customer: params.customer,
    amount: params.amount,
    type: params.billerName,
    item_code: params.item,
    reference: params.reference,
    recurrence: "ONCE",
  });
  // Electricity/utility bills are async — Flutterwave returns "pending" on acceptance;
  // the prepaid token is delivered to the meter or via SMS. Treat "pending" as success.
  return parsePayResult(status, body, params.reference, true);
}

// ── Verify a bill payment by reference (post-acceptance status check) ─────────
export async function verifyBill(reference: string): Promise<{ status: string | null; raw: any }> {
  const { body } = await flwGet<any>(`/bills/${encodeURIComponent(reference)}`);
  return { status: body?.data?.status ?? null, raw: body };
}

// ── Banks ────────────────────────────────────────────────────────────────────
export interface FlwBank { name: string; code: string; slug: string; logo: null }

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function listBanks(): Promise<FlwBank[]> {
  const { status, body } = await flwGet<any>("/banks/NG");
  if (status < 200 || status >= 300 || body?.status === "error") {
    throw new Error(body?.message || `Flutterwave bank list failed (HTTP ${status})`);
  }
  const data: Array<{ name: string; code: string }> = body?.data ?? [];
  return data.map((b) => ({ name: b.name, code: b.code, slug: slugify(b.name), logo: null }));
}

// ── Account resolution (name enquiry) ────────────────────────────────────────
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ account_number: string; account_name: string }> {
  const { status, body } = await flwPost<any>("/accounts/resolve", {
    account_number: accountNumber,
    account_bank: bankCode,
  });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.account_name) {
    throw new Error(body?.message || "Could not verify account");
  }
  return { account_number: body.data.account_number ?? accountNumber, account_name: body.data.account_name };
}

// ── User-friendly error mapping ──────────────────────────────────────────────
// Flutterwave returns raw operational errors (IP not whitelisted, low merchant
// balance, validation) that are confusing/scary to end users. Map them to calm,
// actionable copy. The raw reason should still be logged server-side.
export function friendlyFlwError(raw?: string | null): string {
  const m = (raw ?? "").toLowerCase();
  if (/whitelist|whitelisting/.test(m)) return "Payments are temporarily unavailable. Please try again shortly.";
  if (/insufficient|balance is low|merchant.*balance/.test(m)) return "This service is temporarily unavailable. Please try again later.";
  if (/duplicate|already exists|no duplicate/.test(m)) return "This request was already submitted — check your transactions before trying again.";
  if (/invalid|validation|required|not found|does not exist/.test(m)) return "Some payment details were invalid. Please check them and try again.";
  if (/timeout|timed out|network/.test(m)) return "The payment network is slow right now. Please try again in a moment.";
  return "Payment could not be processed right now. Please try again later.";
}

// ── Bank-transfer charge (in-app deposit account) ────────────────────────────
// Generates a temporary NUBAN the user transfers into from their own bank app.
// The deposit is credited via the charge.completed webhook (and the verify
// endpoint). The displayed account NAME is the merchant's Flutterwave business
// name (dashboard setting), not something we can set per-charge.
export interface FlwBankTransferAccount {
  accountNumber: string;
  bankName: string;
  amount: number;
  reference: string;
  expiresAt: string | null;
  note: string | null;
}

export async function initiateBankTransfer(params: {
  amount: number;
  email: string;
  reference: string;
  fullname?: string;
  narration?: string;
  subaccountId?: string; // Flutterwave subaccount_id — routes 100% of funds to user's subaccount
}): Promise<FlwBankTransferAccount> {
  const payload: Record<string, unknown> = {
    tx_ref: params.reference,
    amount: params.amount,
    email: params.email,
    currency: "NGN",
    fullname: params.fullname,
    narration: params.narration ?? "CipherPay wallet funding",
    is_permanent: false,
  };
  if (params.subaccountId) {
    payload.subaccounts = [{ id: params.subaccountId, transaction_split_ratio: 1 }];
  }
  const { status, body } = await flwPost<any>("/charges?type=bank_transfer", payload);
  const auth = body?.meta?.authorization;
  if (status < 200 || status >= 300 || body?.status !== "success" || !auth?.transfer_account) {
    throw new Error(body?.message || "Could not generate a transfer account");
  }
  return {
    accountNumber: String(auth.transfer_account),
    bankName: String(auth.transfer_bank ?? "Bank"),
    amount: Number(auth.transfer_amount ?? params.amount),
    reference: params.reference,
    expiresAt: auth.account_expiration ? String(auth.account_expiration) : null,
    note: auth.transfer_note ? String(auth.transfer_note) : null,
  };
}

// ── Hosted checkout (wallet funding) ─────────────────────────────────────────
export async function initiatePayment(params: {
  amount: number;
  email: string;
  reference: string;
  redirectUrl: string;
  meta?: Record<string, unknown>;
  name?: string;
  // Restricts the methods shown on the hosted checkout. Bank transfer funding
  // is handled in-app via our fixed account, so hosted checkout is card only.
  paymentOptions?: string;
  subaccountId?: string; // Flutterwave subaccount_id — routes 100% of funds to user's subaccount
}): Promise<{ link: string }> {
  const { status, body } = await flwPost<any>("/payments", {
    tx_ref: params.reference,
    amount: params.amount,
    currency: "NGN",
    redirect_url: params.redirectUrl,
    customer: { email: params.email, name: params.name },
    customizations: { title: "CipherPay Wallet Funding" },
    ...(params.paymentOptions ? { payment_options: params.paymentOptions } : {}),
    meta: params.meta,
    ...(params.subaccountId ? { subaccounts: [{ id: params.subaccountId, transaction_split_ratio: 1 }] } : {}),
  });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.link) {
    throw new Error(body?.message || "Could not start payment");
  }
  return { link: body.data.link };
}

export interface FlwVerifiedCharge {
  status: string; // "successful" on a completed charge
  amount: number; // NGN
  currency: string;
  tx_ref: string;
}

export async function verifyByReference(reference: string): Promise<FlwVerifiedCharge> {
  const { status, body } = await flwGet<any>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
  if (status < 200 || status >= 300 || body?.status === "error") {
    throw new Error(body?.message || `Flutterwave verification failed (HTTP ${status})`);
  }
  const data = body?.data ?? {};
  return {
    status: data?.status ?? "unknown",
    amount: Number(data?.amount ?? 0),
    currency: (data?.currency ?? "NGN").toUpperCase(),
    tx_ref: data?.tx_ref ?? reference,
  };
}

// ── Payout subaccounts / user wallets ────────────────────────────────────────
export interface FlwPayoutWalletResult {
  id: number;
  accountReference: string;
  barterId: string;
  nuban: string | null;
  bankName: string | null;
  bankCode: string | null;
  status: string | null;
  raw: any;
}

export async function createPayoutWallet(params: { accountName: string; email: string; phone?: string }): Promise<FlwPayoutWalletResult> {
  const { status, body } = await flwPost<any>('/payout-subaccounts', {
    account_name: params.accountName,
    email: params.email,
    country: 'NG',
    ...(params.phone ? { mobilenumber: params.phone } : {}),
  });
  const data = body?.data ?? {};
  if (status < 200 || status >= 300 || body?.status !== 'success' || !data?.account_reference) {
    throw new Error(body?.message || 'Flutterwave payout wallet creation failed');
  }
  return {
    id: Number(data.id ?? 0),
    accountReference: String(data.account_reference),
    barterId: String(data.barter_id ?? ''),
    nuban: data.nuban ? String(data.nuban) : null,
    bankName: data.bank_name ? String(data.bank_name) : null,
    bankCode: data.bank_code ? String(data.bank_code) : null,
    status: data.status ? String(data.status) : null,
    raw: body,
  };
}

export async function fetchPayoutStaticAccount(accountReference: string): Promise<{ accountNumber: string; bankName: string; bankCode: string; currency: string }> {
  const path = '/payout-subaccounts/' + encodeURIComponent(accountReference) + '/static-account?currency=NGN&verbose=1';
  const { status, body } = await flwGet<any>(path);
  const data = Array.isArray(body?.data) ? (body.data[0] ?? {}) : (body?.data ?? {});
  if (status < 200 || status >= 300 || body?.status !== 'success' || !data?.static_account) {
    throw new Error(body?.message || 'Flutterwave static account lookup failed');
  }
  return {
    accountNumber: String(data.static_account),
    bankName: String(data.bank_name ?? 'Bank'),
    bankCode: String(data.bank_code ?? ''),
    currency: String(data.currency ?? 'NGN'),
  };
}

export async function fetchPayoutWalletBalance(accountReference: string): Promise<number> {
  const path = '/payout-subaccounts/' + encodeURIComponent(accountReference) + '/balances';
  const { status, body } = await flwGet<any>(path);
  if (status < 200 || status >= 300 || body?.status !== 'success') {
    throw new Error(body?.message || 'Flutterwave payout wallet balance lookup failed');
  }
  const rows = Array.isArray(body?.data) ? body.data : [];
  const ngn = rows.find((row: any) => String(row?.currency ?? '').toUpperCase() === 'NGN');
  return Number(ngn?.available_balance ?? ngn?.availableBalance ?? 0);
}

// ── Wallet-to-wallet funding for bill payments ───────────────────────────────
export async function waitForTransfer(id: number | string, timeoutMs = 30000): Promise<{ status: string | null; raw: any }> {
  const started = Date.now();
  let last: { status: string | null; raw: any } = { status: null, raw: null };
  while (Date.now() - started < timeoutMs) {
    last = await verifyTransferById(id);
    const status = String(last.status ?? "").toUpperCase();
    if (["SUCCESSFUL", "FAILED", "CANCELLED", "REVERSED"].includes(status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return last;
}

export async function movePayoutWalletToMerchant(params: { debitSubaccount: string; amount: number; reference: string }): Promise<FlwTransferResult> {
  const merchantId = process.env.FLUTTERWAVE_MERCHANT_ID;
  if (!merchantId) throw new Error("FLUTTERWAVE_MERCHANT_ID not set");
  const result = await createTransfer({
    amount: params.amount,
    bankCode: "flutterwave",
    accountNumber: merchantId,
    reference: params.reference,
    narration: "CipherPay bill-payment funding",
    debitSubaccount: params.debitSubaccount,
  });
  if (!result.accepted || result.id == null) return result;
  const final = await waitForTransfer(result.id);
  const ok = String(final.status ?? "").toUpperCase() === "SUCCESSFUL";
  return { ...result, accepted: ok, status: final.status, message: ok ? "Wallet funding completed" : (final.raw?.message ?? result.message), raw: final.raw ?? result.raw };
}

export async function moveMerchantToPayoutWallet(params: { payoutBarterId: string; amount: number; reference: string }): Promise<FlwTransferResult> {
  const result = await createTransfer({
    amount: params.amount,
    bankCode: "flutterwave",
    accountNumber: params.payoutBarterId,
    reference: params.reference,
    narration: "CipherPay bill-payment refund",
  });
  if (!result.accepted || result.id == null) return result;
  const final = await waitForTransfer(result.id);
  const ok = String(final.status ?? "").toUpperCase() === "SUCCESSFUL";
  return { ...result, accepted: ok, status: final.status, message: ok ? "Wallet refund completed" : (final.raw?.message ?? result.message), raw: final.raw ?? result.raw };
}

// ── Subaccounts ───────────────────────────────────────────────────────────────
// Subaccounts let transfers appear to originate from a specific user identity
// rather than the main CipherPay merchant account. Pass the returned
// `subaccountId` as `debitSubaccount` in createTransfer.
export interface FlwSubaccountResult {
  subaccountId: string; // e.g. "RS_xxxx" or "PSAFF2118D1A33844332"
  id: number;
  raw: any;
}

export async function createSubaccount(params: {
  accountBank: string;
  accountNumber: string;
  businessName: string;
  businessEmail: string;
}): Promise<FlwSubaccountResult> {
  const { status, body } = await flwPost<any>("/subaccounts", {
    account_bank: params.accountBank,
    account_number: params.accountNumber,
    business_name: params.businessName,
    business_email: params.businessEmail,
    country: "NG",
    split_type: "percentage",
    split_value: 0,
  });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.subaccount_id) {
    throw new Error(body?.message || `Flutterwave subaccount creation failed (HTTP ${status})`);
  }
  return {
    subaccountId: String(body.data.subaccount_id),
    id: Number(body.data.id ?? 0),
    raw: body,
  };
}

// ── Transfers (real bank payouts) ────────────────────────────────────────────
export interface FlwTransferResult {
  accepted: boolean;
  id: number | null;
  status: string | null; // "NEW" | "PENDING" | "SUCCESSFUL" | "FAILED"
  message: string;
  raw: any;
}

export async function createTransfer(params: {
  amount: number; // NGN delivered to the recipient
  bankCode: string;
  accountNumber: string;
  reference: string;
  narration?: string;
  debitSubaccount?: string; // Flutterwave subaccount_id — transfer appears from user identity
}): Promise<FlwTransferResult> {
  const payload: Record<string, unknown> = {
    account_bank: params.bankCode,
    account_number: params.accountNumber,
    amount: params.amount,
    currency: "NGN",
    debit_currency: "NGN",
    reference: params.reference,
    narration: params.narration ?? "CipherPay withdrawal",
  };
  if (params.debitSubaccount) {
    payload.debit_subaccount = params.debitSubaccount;
  }
  const { status, body } = await flwPost<any>("/transfers", payload);
  const accepted = status >= 200 && status < 300 && body?.status === "success";
  return {
    accepted,
    id: body?.data?.id ?? null,
    status: body?.data?.status ?? null,
    message: body?.message ?? (accepted ? "Transfer accepted" : "Transfer failed"),
    raw: body,
  };
}

export async function verifyTransferById(id: number | string): Promise<{ status: string | null; raw: any }> {
  const { body } = await flwGet<any>(`/transfers/${encodeURIComponent(String(id))}`);
  return { status: body?.data?.status ?? null, raw: body };
}
