const BASE = "https://justanotherpanel.com/api/v2";

function apiKey() {
  const k = process.env.JAP_API_KEY;
  if (!k) throw new Error("JAP_API_KEY not set");
  return k;
}

async function call<T = any>(payload: Record<string, string | number>): Promise<T> {
  const form = new URLSearchParams({ key: apiKey(), ...Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.json().catch(() => ({}));
  return body as T;
}

export interface JapService {
  service: number;
  name: string;
  type: string;
  category: string;
  rate: string; // per 1000 in account currency
  min: string;
  max: string;
  refill?: boolean;
  cancel?: boolean;
}

let servicesCache: { at: number; services: JapService[] } | null = null;
const SERVICES_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function listServices(force = false): Promise<JapService[]> {
  if (!force && servicesCache && Date.now() - servicesCache.at < SERVICES_TTL_MS) {
    return servicesCache.services;
  }
  const raw = await call<any>({ action: "services" });
  const services = Array.isArray(raw) ? (raw as JapService[]) : [];
  servicesCache = { at: Date.now(), services };
  return services;
}

// Find a JAP service that best matches the given keywords and quantity.
// Strategy: score each service by how many keywords appear in its name,
// then prefer services where quantity fits, then cheapest.
export async function findService(keywords: string[], quantity: number): Promise<JapService | null> {
  const services = await listServices();
  const lower = keywords.map((k) => k.toLowerCase());

  // The first keyword is the platform/category anchor (e.g. "tiktok", "instagram").
  // The service MUST contain the anchor word.
  const anchor = lower[0];

  const scored = services
    .map((s) => {
      const name = s.name.toLowerCase();
      if (!name.includes(anchor)) return null; // hard filter on anchor
      const min = parseInt(s.min, 10);
      const max = parseInt(s.max, 10);
      const inRange = quantity >= min && quantity <= max;
      const score = lower.filter((k) => name.includes(k)).length;
      return { s, score, inRange, rate: parseFloat(s.rate) };
    })
    .filter(Boolean) as { s: JapService; score: number; inRange: boolean; rate: number }[];

  // Prefer: in-range first, then highest keyword score, then cheapest rate
  const inRange = scored.filter((x) => x.inRange);
  const pool = inRange.length > 0 ? inRange : scored; // fallback: ignore range
  if (pool.length === 0) return null;

  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.rate - b.rate;
  });
  return pool[0].s;
}

export interface AddOrderResult {
  ok: boolean;
  orderId?: number;
  error?: string;
  raw: any;
}

export async function addOrder(params: { service: number; link: string; quantity: number }): Promise<AddOrderResult> {
  const body = await call<any>({ action: "add", service: params.service, link: params.link, quantity: params.quantity });
  if (body?.order) return { ok: true, orderId: Number(body.order), raw: body };
  return { ok: false, error: body?.error ?? "Unknown JAP error", raw: body };
}

export interface OrderStatus {
  charge?: string;
  start_count?: string;
  status?: string; // Pending, In progress, Completed, Partial, Processing, Canceled
  remains?: string;
  currency?: string;
}

export async function getOrderStatus(orderId: number | string): Promise<OrderStatus> {
  return call<OrderStatus>({ action: "status", order: orderId });
}
