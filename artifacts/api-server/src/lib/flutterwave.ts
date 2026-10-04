import { fetch as undiciFetch } from "undici";

const BASE = "https://api.flutterwave.com/v3";

async function flwFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await undiciFetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } catch (err: any) {
    console.error("Flutterwave network request failed", {
      message: err?.message ?? String(err),
      causeCode: err?.cause?.code ?? null,
      causeMessage: err?.cause?.message ?? null,
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
  const res = await flwFetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function flwPost<T = any>(path: string, payload: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const res = await flwFetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(payload.reference || payload.tx_ref ? { "X-Idempotency-Key": String(payload.reference ?? payload.tx_ref) } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function flwPut<T = any>(path: string, payload: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const res = await flwFetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function flwBillPayment<T = any>(billerCode: string, itemCode: string, payload: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const res = await flwFetch(BASE + `/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(itemCode)}/payment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

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

type AirtimeConfig = { billerCode: string; itemCode: string };
let airtimeConfigCache: { at: number; config: AirtimeConfig } | null = null;

async function getAirtimeConfig(): Promise<AirtimeConfig> {
  if (airtimeConfigCache && Date.now() - airtimeConfigCache.at < 10 * 60 * 1000) return airtimeConfigCache.config;
  try {
    const { status, body } = await flwGet<any>("/bill-categories?country=NG");
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    const airtime = rows.find((item) =>
      String(item?.country ?? item?.country_code ?? "").toUpperCase() === "NG" &&
      (item?.is_airtime === true || String(item?.biller_name ?? "").toUpperCase() === "AIRTIME") &&
      item?.biller_code && item?.item_code,
    );
    if (status >= 200 && status < 300 && airtime) {
      const config = { billerCode: String(airtime.biller_code), itemCode: String(airtime.item_code) };
      airtimeConfigCache = { at: Date.now(), config };
      return config;
    }
  } catch (error: any) {
    console.warn("Flutterwave airtime catalog lookup failed", { message: error?.message ?? String(error) });
  }
  return { billerCode: "BIL099", itemCode: "AT099" };
}

export interface FlwResult {
  success: boolean;
  message: string;
  reference?: string;
  flwRef?: string;
  pending?: boolean;
  raw: any;
}

function parsePayResult(status: number, body: any, reference: string, acceptPending = false): FlwResult {
  const bodyStatus = body?.status;
  const ok = status >= 200 && status < 300 && (bodyStatus === "success" || (acceptPending && bodyStatus === "pending"));
  return {
    success: ok,
    message: body?.message ?? (ok ? "Payment accepted" : "Payment failed"),
    reference: body?.data?.reference ?? reference,
    flwRef: body?.data?.flw_ref ?? body?.data?.batch_reference,
    pending: bodyStatus === "pending",
    raw: body,
  };
}

export async function buyAirtime(params: { phone: string; amount: number; reference: string; network: string }): Promise<FlwResult> {
  const { billerCode, itemCode } = await getAirtimeConfig();
  const { status, body } = await flwBillPayment(billerCode, itemCode, { country: "NG", customer_id: params.phone, amount: params.amount, reference: params.reference });
  const initial = parsePayResult(status, body, params.reference, true);
  if (!initial.success || !initial.pending) return initial;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const verified = await verifyBill(params.reference);
      const providerStatus = String(verified.status ?? "").toLowerCase();
      if (["successful", "success", "completed"].includes(providerStatus)) return { ...initial, pending: false, message: "Airtime delivered successfully", raw: verified.raw };
      if (["failed", "cancelled", "canceled", "reversed"].includes(providerStatus)) return { ...initial, success: false, pending: false, message: verified.raw?.message ?? "Airtime payment failed", raw: verified.raw };
    } catch (error: any) {
      console.warn("Flutterwave airtime status check failed", { reference: params.reference, message: error?.message ?? String(error) });
    }
  }
  return { ...initial, pending: true, message: "Airtime purchase is still processing", raw: body };
}

// ── Data bundles (live catalog; NG only) ─────────────────────────────────────
export interface FlwDataPlan { itemCode: string; billerCode: string; billerName: string; name: string; amount: number; network: string | null; }
function dataNetworkFromBiller(billerName: string): string | null {
  const h = billerName.toLowerCase();
  if (h.startsWith("mtn")) return "mtn";
  if (h.startsWith("airtel")) return "airtel";
  if (h.startsWith("glo")) return "glo";
  if (h.startsWith("9mobile") || h.startsWith("9 mobile") || h.startsWith("etisalat")) return "9mobile";
  return null;
}
export async function dataPlans(): Promise<FlwDataPlan[]> {
  const { status, body } = await flwGet<any>("/bill-categories?data_bundle=1&country=NG");
  if (status < 200 || status >= 300 || body?.status === "error") throw new Error(body?.message || `Flutterwave data plans failed (HTTP ${status})`);
  const data: any[] = body?.data ?? [];
  return data.filter((d) => (d?.country ?? "NG") === "NG" && d?.item_code).map((d) => ({
    itemCode: String(d.item_code), billerCode: String(d?.biller_code ?? ""), billerName: String(d?.biller_name ?? d?.name ?? ""), name: String(d?.name ?? d?.biller_name ?? ""), amount: Number(d?.amount ?? 0), network: dataNetworkFromBiller(String(d?.biller_name ?? "")),
  }));
}
export async function buyData(params: { phone: string; amount: number; itemCode: string; billerName: string; billerCode?: string; reference: string }): Promise<FlwResult> {
  const { status, body } = await flwBillPayment(params.billerCode || "", params.itemCode, { country: "NG", customer_id: params.phone, amount: params.amount, reference: params.reference });
  const initial = parsePayResult(status, body, params.reference, true);
  if (!initial.success || !initial.pending) return initial;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const verified = await verifyBill(params.reference);
      const providerStatus = String(verified.status ?? "").toLowerCase();
      if (["successful", "success", "completed"].includes(providerStatus)) return { ...initial, pending: false, message: "Data delivered successfully", raw: verified.raw };
      if (["failed", "cancelled", "canceled", "reversed"].includes(providerStatus)) return { ...initial, success: false, pending: false, message: verified.raw?.message ?? "Data purchase failed", raw: verified.raw };
    } catch (error: any) {
      console.warn("Flutterwave data status check failed", { reference: params.reference, message: error?.message ?? String(error) });
    }
  }
  return { ...initial, pending: true, message: "Data purchase is still processing", raw: body };
}

export interface FlwValidateResult { name: string | null; address: string | null; raw: any; }
export async function validateBill(params: { biller: string; item: string; customer: string }): Promise<FlwValidateResult> {
  const { status, body } = await flwGet<any>(`/bill-items/${encodeURIComponent(params.item)}/validate?customer=${encodeURIComponent(params.customer)}`);
  if (status < 200 || status >= 300 || body?.status === "error") throw new Error(body?.message || `Flutterwave validation failed (HTTP ${status})`);
  const data = body?.data ?? {};
  return { name: data?.name ?? data?.customer ?? null, address: data?.address ?? null, raw: body };
}

export interface FlwElecPlan { itemCode: string; billerCode: string; billerName: string; name: string; }
export async function electricityPlans(): Promise<FlwElecPlan[]> {
  const { status, body } = await flwGet<any>("/bill-categories?electricity=1&country=NG");
  if (status < 200 || status >= 300 || body?.status === "error") throw new Error(body?.message || `Flutterwave electricity catalog failed (HTTP ${status})`);
  const data: any[] = body?.data ?? [];
  return data.filter((d) => d?.item_code).map((d) => ({ itemCode: String(d.item_code), billerCode: String(d?.biller_code ?? ""), billerName: String(d?.biller_name ?? d?.name ?? ""), name: String(d?.name ?? d?.biller_name ?? "") }));
}
export async function payBill(params: { billerName: string; billerCode?: string; item: string; customer: string; amount: number; reference: string }): Promise<FlwResult> {
  if (!params.billerCode) throw new Error("Flutterwave biller code is missing");
  const { status, body } = await flwBillPayment(params.billerCode, params.item, { country: "NG", customer_id: params.customer, amount: params.amount, reference: params.reference });
  return parsePayResult(status, body, params.reference, true);
}
export async function verifyBill(reference: string): Promise<{ status: string | null; raw: any }> {
  const { body } = await flwGet<any>(`/bills/${encodeURIComponent(reference)}`);
  return { status: body?.data?.status ?? body?.status ?? null, raw: body };
}

// Banks
export interface FlwBank { name: string; code: string; slug: string; logo: null }
function slugify(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
export async function listBanks(): Promise<FlwBank[]> {
  const { status, body } = await flwGet<any>("/banks/NG?include_provider_type=1");
  if (status < 200 || status >= 300 || body?.status === "error") throw new Error(body?.message || `Flutterwave bank list failed (HTTP ${status})`);
  const data: Array<{ name: string; code: string }> = body?.data ?? [];
  const banks = data.map((b) => ({ name: b.name, code: b.code, slug: slugify(b.name), logo: null }));
  if (!banks.some((bank) => /opay/i.test(bank.name)) && !banks.some((bank) => bank.code === "100004")) banks.push({ name: "OPay", code: "100004", slug: "opay", logo: null });
  return banks;
}
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<{ account_number: string; account_name: string }> {
  const { status, body } = await flwPost<any>("/accounts/resolve", { account_number: accountNumber, account_bank: bankCode });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.account_name) throw new Error(body?.message || "Could not verify account");
  return { account_number: body.data.account_number ?? accountNumber, account_name: body.data.account_name };
}

export function friendlyFlwError(raw?: string | null): string {
  const m = (raw ?? "").toLowerCase();
  if (/whitelist|whitelisting/.test(m)) return "Payments are temporarily unavailable. Please try again shortly.";
  if (/insufficient|balance is low|merchant.*balance/.test(m)) return "This service is temporarily unavailable. Please try again later.";
  if (/duplicate|already exists|no duplicate/.test(m)) return "This request was already submitted — check your transactions before trying again.";
  if (/invalid|validation|required|not found|does not exist/.test(m)) return "Some payment details were invalid. Please check them and try again.";
  if (/timeout|timed out|network/.test(m)) return "The payment network is slow right now. Please try again in a moment.";
  return "Payment could not be processed right now. Please try again later.";
}

export interface FlwBankTransferAccount { accountNumber: string; bankName: string; amount: number; reference: string; expiresAt: string | null; note: string | null; }
export async function initiateBankTransfer(params: { amount: number; email: string; reference: string; fullname?: string; narration?: string; subaccountId?: string }): Promise<FlwBankTransferAccount> {
  const payload: Record<string, unknown> = { tx_ref: params.reference, amount: params.amount, email: params.email, currency: "NGN", fullname: params.fullname, narration: params.narration ?? "CipherPay wallet funding", is_permanent: false };
  if (params.subaccountId) payload.subaccounts = [{ id: params.subaccountId, transaction_split_ratio: 1 }];
  const { status, body } = await flwPost<any>("/charges?type=bank_transfer", payload);
  const auth = body?.meta?.authorization;
  if (status < 200 || status >= 300 || body?.status !== "success" || !auth?.transfer_account) throw new Error(body?.message || "Could not generate a transfer account");
  return { accountNumber: String(auth.transfer_account), bankName: String(auth.transfer_bank ?? "Bank"), amount: Number(auth.transfer_amount ?? params.amount), reference: params.reference, expiresAt: auth.account_expiration ? String(auth.account_expiration) : null, note: auth.transfer_note ? String(auth.transfer_note) : null };
}
export async function initiatePayment(params: { amount: number; email: string; reference: string; redirectUrl: string; meta?: Record<string, unknown>; name?: string; paymentOptions?: string; subaccountId?: string }): Promise<{ link: string; publicKey?: string }> {
  const { status, body } = await flwPost<any>("/payments", { tx_ref: params.reference, amount: params.amount, currency: "NGN", redirect_url: params.redirectUrl, customer: { email: params.email, name: params.name }, customizations: { title: "CipherPay Wallet Funding" }, ...(params.paymentOptions ? { payment_options: params.paymentOptions } : {}), meta: params.meta, ...(params.subaccountId ? { subaccounts: [{ id: params.subaccountId, transaction_split_ratio: 1 }] } : {}) });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.link) throw new Error(body?.message || "Could not start payment");
  const publicKey = process.env.FLUTTERWAVE_PUBLIC_KEY?.trim() || process.env.FLW_PUBLIC_KEY?.trim() || undefined;
  return { link: body.data.link, publicKey };
}
export interface FlwVerifiedCharge { status: string; amount: number; currency: string; tx_ref: string; }
export async function verifyByReference(reference: string): Promise<FlwVerifiedCharge> {
  const { status, body } = await flwGet<any>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
  if (status < 200 || status >= 300 || body?.status === "error") throw new Error(body?.message || `Flutterwave verification failed (HTTP ${status})`);
  const data = body?.data ?? {};
  return { status: data?.status ?? "unknown", amount: Number(data?.amount ?? 0), currency: (data?.currency ?? "NGN").toUpperCase(), tx_ref: data?.tx_ref ?? reference };
}

// Payout subaccounts
export interface FlwPayoutWalletResult { id: number; accountReference: string; barterId: string; nuban: string | null; bankName: string | null; bankCode: string | null; status: string | null; raw: any; }
export async function findPayoutWalletByEmail(email: string): Promise<FlwPayoutWalletResult | null> {
  const { status, body } = await flwGet<any>(`/payout-subaccounts?email=${encodeURIComponent(email)}&limit=20`);
  if (status < 200 || status >= 300 || body?.status !== 'success') throw new Error(body?.message || `Flutterwave payout wallet lookup failed (HTTP ${status})`);
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.payout_subaccounts) ? body.data.payout_subaccounts : [];
  const match = rows.find((row: any) => String(row?.email ?? '').toLowerCase() === email.trim().toLowerCase() && String(row?.country ?? 'NG').toUpperCase() === 'NG');
  if (!match?.account_reference) return null;
  return { id: Number(match.id ?? 0), accountReference: String(match.account_reference), barterId: String(match.barter_id ?? ''), nuban: match.nuban ? String(match.nuban) : null, bankName: match.bank_name ? String(match.bank_name) : null, bankCode: match.bank_code ? String(match.bank_code) : null, status: match.status ? String(match.status) : null, raw: match };
}
export async function createPayoutWallet(params: { accountName: string; email: string; phone?: string }): Promise<FlwPayoutWalletResult> {
  const { status, body } = await flwPost<any>("/payout-subaccounts", { account_name: params.accountName, email: params.email, country: "NG", ...(params.phone ? { mobilenumber: params.phone } : {}) });
  const data = body?.data ?? {};
  if (status < 200 || status >= 300 || body?.status !== "success" || !data?.account_reference) throw new Error(body?.message || "Flutterwave payout wallet creation failed");
  return { id: Number(data.id ?? 0), accountReference: String(data.account_reference), barterId: String(data.barter_id ?? ""), nuban: data.nuban ? String(data.nuban) : null, bankName: data.bank_name ? String(data.bank_name) : null, bankCode: data.bank_code ? String(data.bank_code) : null, status: data.status ? String(data.status) : null, raw: body };
}
export async function fetchPayoutWallet(accountReference: string): Promise<{ accountReference: string; accountName: string; email: string; status: string; raw: any }> {
  const { status, body } = await flwGet<any>(`/payout-subaccounts/${encodeURIComponent(accountReference)}`);
  const data = Array.isArray(body?.data) ? (body.data[0] ?? {}) : (body?.data ?? {});
  if (status < 200 || status >= 300 || body?.status !== "success" || !data?.account_reference) throw new Error(body?.message || "Flutterwave payout wallet lookup failed");
  return { accountReference: String(data.account_reference), accountName: String(data.account_name ?? ""), email: String(data.email ?? ""), status: String(data.status ?? ""), raw: body };
}
export async function fetchPayoutWalletTransactions(accountReference: string): Promise<any[]> {
  const now = new Date(); const from = new Date(now.getTime() - 48 * 60 * 60 * 1000); const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const { status, body } = await flwGet<any>(`/payout-subaccounts/${encodeURIComponent(accountReference)}/transactions?from=${fmt(from)}&to=${fmt(now)}&currency=NGN&page=1&fetch_limit=100`);
  if (status < 200 || status >= 300 || body?.status !== "success") throw new Error(body?.message || `Flutterwave payout transactions lookup failed (HTTP ${status})`);
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.transactions) ? body.data.transactions : Array.isArray(body?.data?.data) ? body.data.data : [];
  return rows;
}
export async function updatePayoutWallet(accountReference: string, params: { accountName: string; email: string; phone?: string }): Promise<void> {
  const { status, body } = await flwPut<any>(`/payout-subaccounts/${encodeURIComponent(accountReference)}`, { account_name: params.accountName, email: params.email, country: "NG", ...(params.phone ? { mobilenumber: params.phone } : {}) });
  if (status < 200 || status >= 300 || body?.status !== "success") throw new Error(body?.message || "Flutterwave payout wallet update failed");
}
export async function fetchPayoutStaticAccount(accountReference: string): Promise<{ accountNumber: string; bankName: string; bankCode: string; currency: string }> {
  const path = "/payout-subaccounts/" + encodeURIComponent(accountReference) + "/static-account?currency=NGN&verbose=1";
  const { status, body } = await flwGet<any>(path);
  const data = Array.isArray(body?.data) ? (body.data[0] ?? {}) : (body?.data ?? {});
  if (status < 200 || status >= 300 || body?.status !== "success" || !data?.static_account) throw new Error(body?.message || "Flutterwave static account lookup failed");
  return { accountNumber: String(data.static_account), bankName: String(data.bank_name ?? "Bank"), bankCode: String(data.bank_code ?? ""), currency: String(data.currency ?? "NGN") };
}
export async function fetchPayoutWalletBalance(accountReference: string): Promise<number> {
  const path = "/payout-subaccounts/" + encodeURIComponent(accountReference) + "/balances";
  const { status, body } = await flwGet<any>(path);
  if (status < 200 || status >= 300 || body?.status !== "success") throw new Error(body?.message || "Flutterwave payout wallet balance lookup failed");
  const rows = Array.isArray(body?.data) ? body.data : [];
  const ngn = rows.find((row: any) => String(row?.currency ?? "").toUpperCase() === "NGN");
  return Number(ngn?.available_balance ?? ngn?.availableBalance ?? 0);
}
export async function waitForTransfer(id: number | string, timeoutMs = 30000): Promise<{ status: string | null; raw: any }> {
  const started = Date.now(); let last: { status: string | null; raw: any } = { status: null, raw: null };
  while (Date.now() - started < timeoutMs) { last = await verifyTransferById(id); const status = String(last.status ?? "").toUpperCase(); if (["SUCCESSFUL","FAILED","CANCELLED","REVERSED"].includes(status)) return last; await new Promise((resolve) => setTimeout(resolve, 1200)); }
  return last;
}
export async function movePayoutWalletToMerchant(params: { debitSubaccount: string; amount: number; reference: string }): Promise<FlwTransferResult> {
  const merchantId = process.env.FLUTTERWAVE_MERCHANT_ID; if (!merchantId) throw new Error("FLUTTERWAVE_MERCHANT_ID not set");
  const result = await createTransfer({ amount: params.amount, bankCode: "flutterwave", accountNumber: merchantId, reference: params.reference, narration: "CipherPay bill-payment funding", debitSubaccount: params.debitSubaccount });
  if (!result.accepted || result.id == null) return result; const final = await waitForTransfer(result.id); const ok = String(final.status ?? "").toUpperCase() === "SUCCESSFUL";
  return { ...result, accepted: ok, status: final.status, message: ok ? "Wallet funding completed" : (final.raw?.message ?? result.message), raw: final.raw ?? result.raw };
}
export async function moveMerchantToPayoutWallet(params: { payoutBarterId: string; amount: number; reference: string }): Promise<FlwTransferResult> {
  const result = await createTransfer({ amount: params.amount, bankCode: "flutterwave", accountNumber: params.payoutBarterId, reference: params.reference, narration: "CipherPay bill-payment refund" });
  if (!result.accepted || result.id == null) return result; const final = await waitForTransfer(result.id); const ok = String(final.status ?? "").toUpperCase() === "SUCCESSFUL";
  return { ...result, accepted: ok, status: final.status, message: ok ? "Wallet refund completed" : (final.raw?.message ?? result.message), raw: final.raw ?? result.raw };
}
export interface FlwSubaccountResult { subaccountId: string; id: number; raw: any; }
export async function createSubaccount(params: { accountBank: string; accountNumber: string; businessName: string; businessEmail: string }): Promise<FlwSubaccountResult> {
  const { status, body } = await flwPost<any>("/subaccounts", { account_bank: params.accountBank, account_number: params.accountNumber, business_name: params.businessName, business_email: params.businessEmail, country: "NG", split_type: "percentage", split_value: 0 });
  if (status < 200 || status >= 300 || body?.status !== "success" || !body?.data?.subaccount_id) throw new Error(body?.message || `Flutterwave subaccount creation failed (HTTP ${status})`);
  return { subaccountId: String(body.data.subaccount_id), id: Number(body.data.id ?? 0), raw: body };
}
export interface FlwTransferResult { accepted: boolean; id: number | null; status: string | null; message: string; raw: any; }
export async function createTransfer(params: { amount: number; bankCode: string; accountNumber: string; reference: string; narration?: string; debitSubaccount?: string }): Promise<FlwTransferResult> {
  const payload: Record<string, unknown> = { account_bank: params.bankCode, account_number: params.accountNumber, amount: params.amount, currency: "NGN", debit_currency: "NGN", reference: params.reference, narration: params.narration ?? "CipherPay withdrawal" };
  if (params.debitSubaccount) payload.debit_subaccount = params.debitSubaccount;
  const { status, body } = await flwPost<any>("/transfers", payload);
  const accepted = status >= 200 && status < 300 && body?.status === "success";
  return { accepted, id: body?.data?.id ?? null, status: body?.data?.status ?? null, message: body?.message ?? (accepted ? "Transfer accepted" : "Transfer failed"), raw: body };
}
export async function findTransferByReference(reference: string): Promise<any | null> {
  const { status, body } = await flwGet<any>(`/transfers?reference=${encodeURIComponent(reference)}&page=1&page_size=10`);
  if (status < 200 || status >= 300 || body?.status !== "success") return null;
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.find((row: any) => String(row?.reference ?? "") === reference) ?? null;
}
export async function verifyTransferById(id: number | string): Promise<{ status: string | null; raw: any }> {
  const { body } = await flwGet<any>(`/transfers/${encodeURIComponent(String(id))}`);
  return { status: body?.data?.status ?? null, raw: body };
}
