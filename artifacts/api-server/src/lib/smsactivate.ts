const BASE = "https://api.sms-activate.io/stubs/handler_api.php";

function apiKey() {
  const k = process.env.SMSACTIVATE_API_KEY;
  if (!k) throw new Error("SMSACTIVATE_API_KEY not set");
  return k;
}

// Our service IDs → SMS-Activate short codes
const SERVICE_MAP: Record<string, string> = {
  whatsapp: "wa",
  telegram: "tg",
  instagram: "ig",
  facebook: "fb",
  twitter: "tw",
  google: "go",
  tiktok: "lf",
  snapchat: "fu",
  amazon: "am",
  uber: "ub",
  netflix: "nf",
  paypal: "ts",
};
// Our country codes → SMS-Activate numeric country IDs
const COUNTRY_MAP: Record<string, number> = {
  ng: 19, us: 187, gb: 16, de: 43, fr: 78, ru: 0, in: 22, cn: 3, br: 73, gh: 37, ke: 36, za: 31,
};

export function mapServiceCode(service: string): string | null {
  return SERVICE_MAP[service] ?? null;
}
export function mapCountryId(country: string): number | null {
  return COUNTRY_MAP[country] ?? null;
}

async function call(action: string, params: Record<string, string | number>): Promise<string> {
  const qs = new URLSearchParams({ api_key: apiKey(), action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${BASE}?${qs.toString()}`);
  return await res.text();
}

export interface ActivationResult {
  ok: boolean;
  activationId?: string;
  number?: string;
  error?: string;
  raw: string;
}

export async function getNumber(serviceCode: string, countryId: number): Promise<ActivationResult> {
  const txt = await call("getNumber", { service: serviceCode, country: countryId });
  // Success: "ACCESS_NUMBER:id:number"
  if (txt.startsWith("ACCESS_NUMBER")) {
    const [, id, number] = txt.split(":");
    return { ok: true, activationId: id, number, raw: txt };
  }
  // Common errors: NO_NUMBERS, NO_BALANCE, BAD_KEY, BAD_SERVICE, WRONG_SERVICE, WRONG_COUNTRY
  return { ok: false, error: txt, raw: txt };
}

export interface StatusResult {
  status: "pending" | "received" | "cancelled" | "finished" | "unknown";
  code?: string;
  raw: string;
}

export async function getStatus(activationId: string): Promise<StatusResult> {
  const txt = await call("getStatus", { id: activationId });
  // STATUS_WAIT_CODE | STATUS_OK:CODE | STATUS_CANCEL | STATUS_WAIT_RETRY:LASTCODE
  if (txt.startsWith("STATUS_OK")) return { status: "received", code: txt.split(":")[1], raw: txt };
  if (txt.startsWith("STATUS_WAIT")) return { status: "pending", raw: txt };
  if (txt.startsWith("STATUS_CANCEL")) return { status: "cancelled", raw: txt };
  return { status: "unknown", raw: txt };
}

// status: 1=ready/waiting more, 3=request retry, 6=finish (consumed), 8=cancel
export async function setStatus(activationId: string, status: 1 | 3 | 6 | 8): Promise<string> {
  return call("setStatus", { id: activationId, status });
}
