import { directFetch } from "./direct-fetch";

const BASE = "https://api.smspool.net";

function key() {
  const value = process.env.SMSPOOL_API_KEY?.trim();
  if (!value) throw new Error("SMSPOOL_API_KEY not set");
  return value;
}

export async function providerPost<T = any>(path: string, fields: Record<string, string | number> = {}): Promise<T> {
  const form = new URLSearchParams({ key: key(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) });
  const res = await directFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
  return body as T;
}

export async function buyActivation(country: string, service: string, activationType: "SMS" | "VOICE" | "FLASH") {
  return providerPost<any>("/purchase/sms", { country, service, activation_type: activationType, pricing_option: 0, quantity: 1 });
}

export async function esimCountries() { return providerPost<any>("/esim/countries"); }
export async function esimPlans(country: string) { return providerPost<any>("/esim/plans", { country }); }
export async function buyEsim(plan: string) { return providerPost<any>("/esim/purchase", { plan, plan_id: plan }); }
export async function rentalStock() { return providerPost<any>("/rental/stock"); }
export async function rentalPricing(id: string) { return providerPost<any>("/rental/retrieve_pricing", { id }); }
export async function orderRental(id: string, days: number) { return providerPost<any>("/rental/order", { id, days }); }
export async function activeRentals() { return providerPost<any>("/rental/retrieve"); }
export async function rentalMessages(rentalCode: string) { return providerPost<any>("/rental/retrieve_messages", { rental_code: rentalCode }); }
export async function rentalAutoExtend(rentalCode: string) { return providerPost<any>("/rental/auto_extend", { rental_code: rentalCode }); }
