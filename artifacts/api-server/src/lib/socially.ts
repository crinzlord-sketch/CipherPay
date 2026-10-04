import { directFetch } from "./direct-fetch";

// socially.ng API client.
//
// Three product domains share one base URL but two auth styles:
//   - SMM / social boost: classic panel API — POST form to the base URL with `key` in the body.
//   - Data bundle + SMS verification: REST endpoints authed with `Authorization: Bearer <token>`.
//
// All Bearer responses are wrapped as { status, message, data }.

const DEFAULT_BASE = "https://socially.ng/api/v1";

function baseUrl(): string {
  return (process.env.SOCIALLY_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
}

function apiKey(): string {
  const k = process.env.SOCIALLY_API_KEY;
  if (!k) throw new Error("SOCIALLY_API_KEY not set");
  return k;
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// ── SMM (social boost) ──────────────────────────────────────────────────────

async function smmCall<T = any>(action: string, extra: Record<string, string | number> = {}): Promise<T> {
  const form = new URLSearchParams({
    key: apiKey(),
    action,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  });
  const res = await directFetch(baseUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  const body: any = await res.json().catch(() => ({}));
  return body as T;
}

export interface SmmService {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: number; // price per 1000 in NGN
  min: number;
  max: number;
  refill?: boolean;
  cancel?: boolean;
  dripfeed?: boolean;
  refillDays?: number;
  providerClaims?: string[];
}

let smmServicesCache: { at: number; services: SmmService[] } | null = null;
const SMM_TTL_MS = 60 * 60 * 1000;

export async function smmServices(force = false): Promise<SmmService[]> {
  if (!force && smmServicesCache && Date.now() - smmServicesCache.at < SMM_TTL_MS) {
    return smmServicesCache.services;
  }
  const raw = await smmCall<any>("services");
  const arr: any[] = Array.isArray(raw) ? raw : [];
  const services: SmmService[] = arr.map((s) => ({
    service: Number(s.service),
    name: String(s.name ?? ""),
    type: String(s.type ?? "default"),
    category: String(s.category ?? ""),
    rate: num(s.rate),
    min: Math.trunc(num(s.min)),
    max: Math.trunc(num(s.max)),
    refill: Boolean(s.refill),
    cancel: Boolean(s.cancel),
    dripfeed: Boolean(s.dripfeed ?? s.drip_feed),
    refillDays: (() => { const m = String(s.name ?? "").match(/(\\d+)\\s*[- ]?day(?:s)?\\s*(?:refill|guarantee)/i); return m ? Number(m[1]) : undefined; })(),
    providerClaims: [
      s.refill ? "Refill available" : "No refill flag",
      s.cancel ? "Cancellation supported" : "Cancellation unavailable",
      (s.dripfeed ?? s.drip_feed) ? "Drip-feed supported" : "Standard delivery",
    ],
  }));
  if (services.length > 0) smmServicesCache = { at: Date.now(), services };
  return services;
}

// Find the socially SMM service that best matches the given keywords and quantity.
// First keyword is the platform anchor and MUST appear in the service name or category.
// Prefer: quantity in range, then highest keyword match, then cheapest rate.
export async function smmFindService(keywords: string[], quantity: number): Promise<SmmService | null> {
  const services = await smmServices();
  const lower = keywords.map((k) => k.toLowerCase());
  const anchor = lower[0];

  const scored = services
    .map((s) => {
      const hay = `${s.name} ${s.category}`.toLowerCase();
      if (anchor && !hay.includes(anchor)) return null;
      const inRange = quantity >= s.min && quantity <= s.max;
      const score = lower.filter((k) => hay.includes(k)).length;
      return { s, score, inRange, rate: s.rate };
    })
    .filter(Boolean) as { s: SmmService; score: number; inRange: boolean; rate: number }[];

  const inRange = scored.filter((x) => x.inRange);
  const pool = inRange.length > 0 ? inRange : scored;
  if (pool.length === 0) return null;

  pool.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.rate - b.rate));
  return pool[0].s;
}

export interface SmmAddResult {
  ok: boolean;
  orderId?: string;
  charge?: number;
  error?: string;
  raw: any;
}

export async function smmAddOrder(params: { service: number; link: string; quantity: number }): Promise<SmmAddResult> {
  const body = await smmCall<any>("add", { service: params.service, link: params.link, quantity: params.quantity });
  if (body?.order) return { ok: true, orderId: String(body.order), charge: num(body.charge), raw: body };
  return { ok: false, error: body?.error ?? body?.message ?? "Unknown socially SMM error", raw: body };
}

export interface SmmOrderStatus {
  status?: string; // processing, completed, partial, canceled, pending, in progress
  start_count?: number;
  remains?: number;
  charge?: number;
  raw: any;
}

export async function smmOrderStatus(order: string | number): Promise<SmmOrderStatus> {
  const body = await smmCall<any>("status", { order });
  return {
    status: body?.status ? String(body.status) : undefined,
    start_count: body?.start_count != null ? Math.trunc(num(body.start_count)) : undefined,
    remains: body?.remains != null ? Math.trunc(num(body.remains)) : undefined,
    charge: body?.charge != null ? num(body.charge) : undefined,
    raw: body,
  };
}

// ── Bearer (data bundle + SMS verification) ─────────────────────────────────

async function bearerGet<T = any>(path: string): Promise<{ ok: boolean; data: T | null; message: string; raw: any }> {
  const res = await directFetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
  });
  const body: any = await res.json().catch(() => ({}));
  const ok = res.ok && (body?.status === undefined || body?.status === "success" || body?.status === true);
  return { ok, data: (body?.data ?? null) as T | null, message: String(body?.message ?? ""), raw: body };
}

async function bearerPostForm<T = any>(
  path: string,
  fields: Record<string, string | number>,
): Promise<{ ok: boolean; data: T | null; message: string; raw: any }> {
  const form = new URLSearchParams(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
  );
  const res = await directFetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body: any = await res.json().catch(() => ({}));
  const ok = res.ok && (body?.status === undefined || body?.status === "success" || body?.status === true);
  return { ok, data: (body?.data ?? null) as T | null, message: String(body?.message ?? ""), raw: body };
}

// ── Data bundle ─────────────────────────────────────────────────────────────

export interface SociallyDataProvider {
  provider_code: string;
  provider_name: string;
  min_amount?: number;
  max_amount?: number;
}

export interface SociallyDataPackage {
  package_code: string;
  package_name: string;
  provider_code: string;
  amount: number;
}

export async function dataProviders(): Promise<SociallyDataProvider[]> {
  const { data } = await bearerGet<any[]>("/pay/bills/providers/data-bundle");
  const arr = Array.isArray(data) ? data : [];
  return arr.map((p) => ({
    provider_code: String(p.provider_code ?? p.code ?? ""),
    provider_name: String(p.provider_name ?? p.name ?? ""),
    min_amount: p.min_amount != null ? num(p.min_amount) : undefined,
    max_amount: p.max_amount != null ? num(p.max_amount) : undefined,
  })).filter((p) => p.provider_code);
}

export async function dataPackages(providerCode: string): Promise<SociallyDataPackage[]> {
  const { data } = await bearerGet<any[]>(`/pay/bills/provider/data-bundle/${encodeURIComponent(providerCode)}/packages`);
  const arr = Array.isArray(data) ? data : [];
  return arr.map((p) => ({
    package_code: String(p.package_code ?? p.code ?? ""),
    package_name: String(p.package_name ?? p.name ?? ""),
    provider_code: String(p.provider_code ?? providerCode),
    amount: num(p.package_original_amount ?? p.package_amount ?? p.amount ?? p.price),
  })).filter((p) => p.package_code && p.amount > 0);
}

export interface SociallyBuyResult {
  ok: boolean;
  reference?: string;
  status?: string;
  message: string;
  raw: any;
}

export async function buyDataBundle(params: {
  providerCode: string;
  recipient: string;
  packageCode: string;
  reference: string;
}): Promise<SociallyBuyResult> {
  const { ok, data, message, raw } = await bearerPostForm<any>("/pay/bills/buy/data-bundle", {
    provider_code: params.providerCode,
    recipient: params.recipient,
    package_code: params.packageCode,
    reference: params.reference,
  });
  const status = data?.status ? String(data.status) : undefined;
  const delivered = ok && (!status || /success|deliver|complete|process|pending/i.test(status));
  return { ok: delivered, reference: data?.reference ? String(data.reference) : params.reference, status, message, raw };
}

// ── SMS verification ────────────────────────────────────────────────────────

export interface SociallyProvider {
  provider_code: string;
  provider_name: string;
}

export interface SociallyCountry {
  country_code: string;
  title: string;
  code?: string; // ISO-ish code, when present
}

export interface SociallyProject {
  project_code: string;
  project_name: string;
  country_code: string;
  price: number;
}

let smsProvidersCache: { at: number; providers: SociallyProvider[] } | null = null;

export async function smsProviders(force = false): Promise<SociallyProvider[]> {
  if (!force && smsProvidersCache && Date.now() - smsProvidersCache.at < SMM_TTL_MS) {
    return smsProvidersCache.providers;
  }
  const { data } = await bearerGet<any[]>("/sms/verification/providers");
  const arr = Array.isArray(data) ? data : [];
  const providers = arr.map((p) => ({
    provider_code: String(p.provider_code ?? p.code ?? ""),
    provider_name: String(p.provider_name ?? p.name ?? ""),
  })).filter((p) => p.provider_code);
  if (providers.length > 0) smsProvidersCache = { at: Date.now(), providers };
  return providers;
}

// The default provider/server to use for SMS verification (first available).
export async function defaultSmsProvider(): Promise<string | null> {
  const providers = await smsProviders();
  return providers[0]?.provider_code ?? null;
}

export async function smsCountries(providerCode: string): Promise<SociallyCountry[]> {
  const { data } = await bearerGet<any[]>(`/sms/verification/provider/${encodeURIComponent(providerCode)}/countries`);
  const arr = Array.isArray(data) ? data : [];
  return arr.map((c) => ({
    country_code: String(c.country_id ?? c.country_code ?? ""),
    title: String(c.title ?? c.name ?? ""),
    code: c.code != null ? String(c.code) : undefined,
  })).filter((c) => c.country_code);
}

export async function smsProjects(providerCode: string, countryCode: string): Promise<SociallyProject[]> {
  const { data } = await bearerPostForm<any[]>("/sms/verification/service/provider/packages", {
    provider_code: providerCode,
    country_code: countryCode,
  });
  const arr = Array.isArray(data) ? data : [];
  return arr.map((p) => ({
    project_code: String(p.project_code ?? p.code ?? ""),
    project_name: String(p.project_name ?? p.name ?? ""),
    country_code: String(p.country_code ?? countryCode),
    price: num(p.price ?? p.amount),
  })).filter((p) => p.project_code && p.price > 0);
}

export interface SociallyNumberResult {
  ok: boolean;
  reference?: string;
  number?: string;
  status?: string;
  message: string;
  raw: any;
}

export async function buySmsNumber(params: {
  providerCode: string;
  countryCode: string;
  projectCode: string;
  reference: string;
}): Promise<SociallyNumberResult> {
  const { ok, data, message, raw } = await bearerPostForm<any>("/buy/sms/verification/number", {
    provider_code: params.providerCode,
    country_code: params.countryCode,
    project_code: params.projectCode,
    reference: params.reference,
  });
  const number = data?.mobile_number ?? data?.number ?? data?.phone;
  return {
    ok: ok && Boolean(number),
    reference: data?.reference ? String(data.reference) : params.reference,
    number: number != null ? String(number) : undefined,
    status: data?.status ? String(data.status) : undefined,
    message,
    raw,
  };
}

export interface SociallyOtpResult {
  status: "received" | "pending" | "cancelled";
  code?: string;
  raw: any;
}

// Poll the inbox for a received OTP. The code may arrive in data.otp/data.code/data.sms
// or embedded in the human-readable message ("Your OTP (1234) has been received").
export async function smsOtp(reference: string): Promise<SociallyOtpResult> {
  const { data, message, raw } = await bearerGet<any>(
    `/request/sms/verification/${encodeURIComponent(reference)}/otp`,
  );

  const lowerMsg = message.toLowerCase();
  if (/cancel|expir|refund|timed?\s*out/.test(lowerMsg)) {
    return { status: "cancelled", raw };
  }

  const direct = data?.otp ?? data?.code ?? data?.sms ?? data?.pin;
  if (direct != null && String(direct).trim() !== "") {
    return { status: "received", code: String(direct).trim(), raw };
  }

  // Only treat a number embedded in the message as a code when it is not a "waiting" message.
  const waiting = /wait|pending|not\s*(yet\s*)?received|no\s*(otp|sms|code)/.test(lowerMsg);
  if (!waiting) {
    const m = message.match(/(\d{3,8})/);
    if (m) return { status: "received", code: m[1], raw };
  }

  return { status: "pending", raw };
}


export async function smmMassOrder(lines: Array<{ service: number; quantity: number; link: string }>): Promise<SmmAddResult[]> {
  const results: SmmAddResult[] = [];
  for (const item of lines) {
    results.push(await smmAddOrder(item));
  }
  return results;
}
