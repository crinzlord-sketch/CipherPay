import { directFetch } from "./direct-fetch";

const BASE = "https://api.smspool.net";

function apiKey(): string {
  const key = process.env.SMSPOOL_API_KEY?.trim();
  if (!key) throw new Error("SMSPOOL_API_KEY not set");
  return key;
}

function providerMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const firstError = errors[0];
  if (firstError && typeof firstError === "object") {
    const message = (firstError as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  for (const key of ["message", "error", "detail", "type"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim();
  }
  return "";
}

async function request<T>(path: string, fields?: Record<string, string>): Promise<T> {
  const form = new URLSearchParams({ key: apiKey(), ...(fields ?? {}) });
  const response = await directFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = providerMessage(body);
    throw new Error(`SMSPool returned HTTP ${response.status}${message ? `: ${message}` : ""}`);
  }
  if (body == null) throw new Error("SMSPool returned an empty response");
  return body as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await directFetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`SMSPool returned HTTP ${response.status}`);
  if (body == null) throw new Error("SMSPool returned an empty response");
  return body as T;
}

export interface SmsPoolCountry {
  id: string;
  name: string;
  iso: string;
}

export interface SmsPoolService {
  id: string;
  name: string;
}

export interface SmsPoolOffer {
  serviceId: string;
  serviceName: string;
  countryId: string;
  countryName: string;
  iso: string;
  poolId: string;
  priceUsd: number;
}

function listOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["data", "results", "items"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export async function listCountries(): Promise<SmsPoolCountry[]> {
  const rows = listOf<Record<string, unknown>>(await get("/country/retrieve_all"));
  return rows.map((row) => ({
    id: String(row.ID ?? row.id ?? ""),
    name: String(row.name ?? row.country_name ?? ""),
    iso: String(row.short_name ?? row.iso ?? ""),
  })).filter((row) => row.id && row.name);
}

export async function listServices(): Promise<SmsPoolService[]> {
  const rows = listOf<Record<string, unknown>>(await get("/service/retrieve_all"));
  return rows.map((row) => ({
    id: String(row.ID ?? row.id ?? row.service ?? ""),
    name: String(row.name ?? row.service_name ?? ""),
  })).filter((row) => row.id && row.name);
}

let ngnPerUsdCache: { value: number; fetchedAt: number } | null = null;

export async function getNgnPerUsd(): Promise<number> {
  if (ngnPerUsdCache && Date.now() - ngnPerUsdCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return ngnPerUsdCache.value;
  }
  const response = await directFetch("https://open.er-api.com/v6/latest/USD", {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null) as { result?: string; rates?: { NGN?: number } } | null;
  const rate = Number(body?.rates?.NGN);
  if (!response.ok || body?.result !== "success" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Could not retrieve a current USD/NGN rate");
  }
  ngnPerUsdCache = { value: rate, fetchedAt: Date.now() };
  return rate;
}

export async function listOffers(countryId: string): Promise<SmsPoolOffer[]> {
  const [rawOffers, countries, services] = await Promise.all([
    request<unknown>("/request/pricing", { country: countryId }),
    listCountries(),
    listServices(),
  ]);
  const rows = listOf<Record<string, unknown>>(rawOffers);
  const country = countries.find((item) => item.id === countryId);
  const serviceById = new Map(services.map((service) => [service.id, service.name]));
  return rows.map((row) => {
    const serviceId = String(row.service ?? row.service_id ?? "");
    const priceUsd = Number(row.price ?? row.high_price ?? row.cost);
    return {
      serviceId,
      serviceName: String(row.service_name ?? row.name ?? serviceById.get(serviceId) ?? ""),
      countryId: String(row.country ?? row.country_id ?? countryId),
      countryName: String(row.country_name ?? country?.name ?? countryId),
      iso: String(row.short_name ?? country?.iso ?? ""),
      poolId: String(row.pool ?? row.pool_id ?? ""),
      priceUsd,
    };
  }).filter((offer) =>
    offer.serviceId &&
    offer.serviceName &&
    offer.poolId &&
    Number.isFinite(offer.priceUsd) &&
    offer.priceUsd > 0
  );
}

export async function getOffer(countryId: string, serviceId: string): Promise<SmsPoolOffer | null> {
  const offers = await listOffers(countryId);
  const matches = offers.filter((offer) => offer.serviceId === serviceId);
  matches.sort((a, b) => a.priceUsd - b.priceUsd);
  return matches[0] ?? null;
}

export async function toNgn(usd: number): Promise<number> {
  const rate = await getNgnPerUsd();
  return Math.ceil((usd * rate) / 10) * 10;
}

export async function orderNumber(offer: SmsPoolOffer): Promise<{
  orderId: string;
  number: string;
  expiresIn: number;
  costUsd: number;
}> {
  const fields = {
    country: offer.countryId,
    service: offer.serviceId,
    max_price: String(offer.priceUsd),
    pricing_option: "0",
    quantity: "1",
    activation_type: "SMS",
  };
  let response: Record<string, unknown>;
  try {
    response = await request<Record<string, unknown>>("/purchase/sms", {
      ...fields,
      pool: offer.poolId,
    });
  } catch (error) {
    // Pricing can expose a pool that becomes unavailable before purchase.
    // Let SMSPool select another pool, but keep max_price so the debit remains safe.
    if (!offer.poolId || !(error instanceof Error && /HTTP 422|OUT_OF_STOCK|PRICE_NOT_FOUND/i.test(error.message))) {
      throw error;
    }
    response = await request<Record<string, unknown>>("/purchase/sms", fields);
  }
  if (Number(response.success) !== 1) {
    const failureType = String(response.type ?? "");
    if (offer.poolId && /OUT_OF_STOCK|PRICE_NOT_FOUND/i.test(failureType)) {
      response = await request<Record<string, unknown>>("/purchase/sms", fields);
    }
  }
  if (Number(response.success) !== 1) {
    const kind = String(response.type ?? "ORDER_FAILED");
    throw new Error(kind === "OUT_OF_STOCK"
      ? "No number is available for this service and country right now"
      : kind === "BALANCE_ERROR"
        ? "SMSPool account has insufficient provider balance"
        : String(response.message ?? kind));
  }
  const orderId = String(response.order_id ?? "");
  const number = String(response.number ?? response.phonenumber ?? "");
  if (!orderId || !number) throw new Error("SMSPool response did not include the number and order reference");
  return {
    orderId,
    number: number.startsWith("+") ? number : `+${number}`,
    expiresIn: Number(response.expires_in) || 1200,
    costUsd: Number(response.cost) || offer.priceUsd,
  };
}

export async function checkOrder(orderId: string): Promise<{
  status: "pending" | "received" | "cancelled" | "unknown";
  code?: string;
  fullSms?: string;
}> {
  const response = await request<Record<string, unknown>>("/sms/check", { orderid: orderId });
  const status = Number(response.status);
  if (status === 3) {
    return {
      status: "received",
      code: response.sms == null ? undefined : String(response.sms),
      fullSms: response.full_sms == null ? undefined : String(response.full_sms),
    };
  }
  if (status === 6) return { status: "cancelled" };
  if (status === 1) return { status: "pending" };
  return { status: "unknown" };
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  const response = await request<Record<string, unknown>>("/sms/cancel", { orderid: orderId });
  return Number(response.success) === 1;
}