import { Router, type IRouter } from "express";
import { and, eq, lt, notInArray } from "drizzle-orm";
import { db, smsActivationsTable, socialOrdersTable, transactionsTable, usersTable } from "@workspace/db";
import {
  BuyAirtimeBody, BuyDataBody, PayBillBody, ValidateBillBody,
  PlaceSocialOrderBody, BuySmsNumberBody,
} from "@workspace/api-zod";
import { creditWallet, debitWallet, formatTransaction } from "../lib/wallet";
import {
  flwReference, buyAirtime as flwBuyAirtime, movePayoutWalletToMerchant, moveMerchantToPayoutWallet, fetchPayoutWalletBalance, findTransferByReference, verifyTransferById,
  dataPlans as flwDataPlans, buyData as flwBuyData,
  electricityPlans as flwElecPlans,
  FLW_ELECTRICITY, validateBill as flwValidateBill, payBill as flwPayBill, verifyBill as flwVerifyBill,
} from "../lib/flutterwave";
import {
  listCountries as listSmsPoolCountries,
  listOffers as listSmsPoolOffers,
  getOffer as getSmsPoolOffer,
  getNgnPerUsd as getSmsPoolNgnPerUsd,
  orderNumber as orderSmsPoolNumber,
  checkOrder as checkSmsPoolOrder,
  cancelOrder as cancelSmsPoolOrder,
} from "../lib/smspool";
import { smmFindService, smmAddOrder, smmOrderStatus } from "../lib/socially";
import { logoPath } from "../lib/logos";
import { checkPerTxLimitSync, getUserKycLevel } from "../lib/kycLimits";
import { ensureUserPayoutWallet } from "../lib/payout-wallet";

const router: IRouter = Router();

function getUserId(req: any): number | null {
  const rawId = req.headers["x-user-id"];
  const id = parseInt(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""), 10);
  return isNaN(id) ? null : id;
}

const SMS_CANCEL_AFTER_MS = 15 * 60 * 1000;
function normalizeNgPhone(phone: string): string {
  const raw = String(phone ?? "").trim().replace(/[\\s().-]/g, "");
  if (raw.startsWith("+234")) return raw;
  if (raw.startsWith("234")) return `+${raw}`;
  if (raw.startsWith("0")) return `+234${raw.slice(1)}`;
  return raw;
}

// Mark a previously-successful debit as failed and credit back the same amount.
// Idempotent: only refunds if the debit row is still in "success" state (CAS via WHERE clause).
async function fundBillSourceFromUser(userId: number, amount: number, txId: number): Promise<{ barterId: string }> {
  const payout = await ensureUserPayoutWallet(userId);
  const providerBalance = await fetchPayoutWalletBalance(payout.accountReference);
  if (providerBalance < amount) throw new Error("Your available wallet balance is not enough to complete this purchase.");

  // One deterministic provider reference per CipherPay debit. If Render retries
  // the request after a timeout, reconcile the original transfer instead of
  // creating a second debit from the user's payout wallet.
  const reference = `CP-SRC-${txId}`.slice(0, 48);
  const existing = await findTransferByReference(reference);
  if (existing) {
    const status = String(existing.status ?? "").toUpperCase();
    if (status === "SUCCESSFUL") return { barterId: payout.barterId };
    if (existing.id != null) {
      const final = await verifyTransferById(existing.id);
      const finalStatus = String(final.status ?? "").toUpperCase();
      if (finalStatus === "SUCCESSFUL") return { barterId: payout.barterId };
      throw new Error(final.raw?.message || "The existing purchase-funding transfer is still processing.");
    }
  }

  const moved = await movePayoutWalletToMerchant({
    debitSubaccount: payout.accountReference,
    amount,
    reference,
  });
  if (!moved.accepted) throw new Error(moved.message || "Could not fund this purchase.");
  return { barterId: payout.barterId };
}

async function refundBillSourceToUser(userId: number, amount: number, txId: number): Promise<void> {
  try {
    const payout = await ensureUserPayoutWallet(userId);
    const reference = `CP-REF-${txId}`.slice(0, 48);
    const existing = await findTransferByReference(reference);
    if (existing && String(existing.status ?? "").toUpperCase() === "SUCCESSFUL") return;

    const moved = await moveMerchantToPayoutWallet({
      payoutBarterId: payout.barterId,
      amount,
      reference,
    });
    if (!moved.accepted) throw new Error(moved.message || "Refund transfer failed");
  } catch (e: any) {
    console.error("Flutterwave purchase refund transfer failed", { userId, txId, amount, error: e?.message });
  }
}

async function refundFailed(userId: number, txId: number, amount: number, reason: string, type: string): Promise<boolean> {
  const updated = await db.update(transactionsTable)
    .set({ status: "failed", description: reason })
    .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.status, "success")))
    .returning({ id: transactionsTable.id });
  if (updated.length === 0) return false; // already refunded or not in refundable state
  await creditWallet(userId, amount, `Refund: ${reason}`, "refund", { originalTxId: txId, type });
  return true;
}

async function refundSmsActivation(activation: typeof smsActivationsTable.$inferSelect, reason: string): Promise<boolean> {
  if (activation.transactionId == null) return false;
  const refundedNow = await refundFailed(
    activation.userId,
    activation.transactionId,
    parseFloat(activation.amount),
    reason,
    "sms",
  );
  if (refundedNow) return true;
  const [transaction] = await db.select({ status: transactionsTable.status })
    .from(transactionsTable)
    .where(eq(transactionsTable.id, activation.transactionId));
  return transaction?.status === "failed";
}

// Best-effort post-success persistence. Logs but never refunds — provider already fulfilled.
async function safePersist(req: any, txId: number, fn: () => Promise<void>) {
  try { await fn(); } catch (e: any) {
    (req.log ?? console).warn?.({ txId, err: e?.message }, "post-success persistence failed; provider already fulfilled");
  }
}

// ── NETWORKS ──────────────────────────────────────────────────────────────
const NETWORKS = [
  { id: "mtn", name: "MTN Nigeria", code: "mtn", logo: logoPath("mtn") },
  { id: "glo", name: "Glo Mobile", code: "glo", logo: logoPath("glo") },
  { id: "airtel", name: "Airtel Nigeria", code: "airtel", logo: logoPath("airtel") },
  { id: "9mobile", name: "9Mobile", code: "9mobile", logo: logoPath("9mobile") },
];

router.get("/airtime/networks", (_req, res) => { res.json(NETWORKS); });


// Airtime and data are sold at the provider price. CipherPay does not add a
// service/profit fee to either VAS purchase.
const VAS_PROFIT_FEE = 0;

function dataRetailPrice(wholesaleAmount: number, _sizeStr: string): number {
  return Math.max(Number(wholesaleAmount) || 0, 0);
}

router.post("/airtime/buy", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = BuyAirtimeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { network, phone: rawPhone, amount } = parsed.data;
  const phone = normalizeNgPhone(rawPhone);
  const networkObj = NETWORKS.find(n => n.id === network);
  const charge = amount;

  const kycLevel = await getUserKycLevel(userId);
  const airtimeLimitError = checkPerTxLimitSync(kycLevel, charge);
  if (airtimeLimitError) { res.status(400).json({ error: airtimeLimitError }); return; }

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, charge, `${networkObj?.name ?? network} airtime - ${phone}`, "airtime", { network, phone, amount, fee: 0 }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  try {
    // Flutterwave bill payments debit the merchant's already-funded bill-payment
    // source balance directly. Do not transfer each user's purchase into that
    // source wallet first; doing so can create an unnecessary async transfer
    // failure even when the bill-payment source is funded.
    const reference = flwReference(`AIR${tx.id}`);
    const result = await flwBuyAirtime({ phone, amount, reference, network });
    req.log.info({ flwStatus: result.raw?.status, flwMessage: result.raw?.message, flwData: result.raw?.data, reference, processing: result.pending === true }, "Flutterwave airtime response");
    if (!result.success) {
      await refundFailed(userId, tx.id, charge, `Airtime delivery failed: ${result.message}`, "airtime");
      res.status(502).json({
        error: `Airtime delivery failed. You have been refunded.`,
        details: result.message,
        providerResponse: { status: result.raw?.status, message: result.raw?.message, data: result.raw?.data ?? null },
      });
      return;
    }
    await safePersist(req, tx.id, async () => {
      await db.update(transactionsTable).set({
        status: result.pending ? "pending" : "success",
        metadata: JSON.stringify({ network, phone, amount, providerRef: result.flwRef ?? result.reference, providerStatus: result.message }),
      }).where(eq(transactionsTable.id, tx.id));
    });
    res.json({
      success: true,
      processing: result.pending === true,
      message: result.pending
        ? "Airtime purchase is still processing. You have not been charged any extra fee."
        : "Airtime delivered successfully",
      reference,
      transaction: formatTransaction({ ...tx, status: result.pending ? "pending" : "success" }),
    });
  } catch (e: any) {
    await refundFailed(userId, tx.id, charge, `Provider error: ${e.message ?? "unknown"}`, "airtime");
    res.status(502).json({ error: "Provider error. You have been refunded.", details: e.message });
  }
});

// ── DATA PLANS — powered by Flutterwave (cached 1h) ───────────────────────
// Plans catalog uses GET /bill-categories?data_bundle=1 (no IP whitelist).
// Purchase uses POST /v3/bills (requires Flutterwave IP whitelist — same as
// airtime/electricity). Plans are fetched once per hour and filtered per network.

const DATA_TTL_MS = 60 * 60 * 1000;
let rawDataCache: { at: number; plans: Awaited<ReturnType<typeof flwDataPlans>> } | null = null;

// ── Electricity catalog cache (1h TTL) ───────────────────────────────────────
let rawElecCache: { at: number; plans: Awaited<ReturnType<typeof flwElecPlans>> } | null = null;

async function getElecBillerName(billerCode: string, itemCode: string): Promise<string | null> {
  if (!rawElecCache || Date.now() - rawElecCache.at >= DATA_TTL_MS) {
    try {
      const plans = await flwElecPlans();
      if (plans.length > 0) rawElecCache = { at: Date.now(), plans };
    } catch { /* leave cache stale */ }
  }
  if (!rawElecCache) return null;
  const match = rawElecCache.plans.find(p => p.billerCode === billerCode && p.itemCode === itemCode);
  return match?.billerName ?? null;
}

function parsePlanMeta(name: string): { size: string; validity: string } {
  const sizeMatch = name.match(/(\d+(?:\.\d+)?\s*(?:MB|GB|TB))/i);
  const validityMatch = name.match(/(\d+\s*(?:Day|Days|Week|Weeks|Month|Months|Hour|Hours|Year|Years))/i)
    ?? name.match(/(Daily|Weekly|Monthly|Yearly)/i);
  return { size: sizeMatch?.[1]?.toUpperCase().replace(/\s+/g, "") ?? "", validity: validityMatch?.[1] ?? "" };
}

type DataPlan = { id: string; name: string; size: string; validity: string; price: number; wholesalePrice: number; network: string; billerName: string; billerCode: string };

async function getAllDataPlansRaw(): Promise<Awaited<ReturnType<typeof flwDataPlans>>> {
  if (rawDataCache && Date.now() - rawDataCache.at < DATA_TTL_MS) return rawDataCache.plans;
  let raw: Awaited<ReturnType<typeof flwDataPlans>> = [];
  try { raw = await flwDataPlans(); } catch { raw = []; }
  if (raw.length > 0) rawDataCache = { at: Date.now(), plans: raw };
  return raw;
}

async function getDataPlans(network: string): Promise<DataPlan[]> {
  const raw = await getAllDataPlansRaw();
  return raw
    .filter(p => p.network === network && p.amount > 0)
    .map(p => {
      const meta = parsePlanMeta(p.name);
      return {
        id: p.itemCode,            // Flutterwave item_code — used as planId in /data/buy
        name: p.name,
        size: meta.size,
        validity: meta.validity,
        price: dataRetailPrice(p.amount, meta.size),
        wholesalePrice: p.amount,  // charged to Flutterwave; user pays the retail price
        network,
        billerName: p.billerName,
        billerCode: p.billerCode,
      };
    });
}

router.get("/data/plans", async (req, res): Promise<void> => {
  const network = (req.query.network as string) ?? "";
  if (network && NETWORKS.some(n => n.id === network)) {
    res.json(await getDataPlans(network));
    return;
  }
  const all = await Promise.all(NETWORKS.map(n => getDataPlans(n.id)));
  res.json(all.flat());
});

router.post("/data/buy", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = BuyDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    return;
  }

  const { network, phone: rawPhone, planId } = parsed.data;
  const phone = normalizeNgPhone(rawPhone);
  const plans = await getDataPlans(network);
  const plan = plans.find(p => p.id === planId);
  if (!plan) { res.status(400).json({ error: "Plan not found or no longer available" }); return; }

  const kycLevel = await getUserKycLevel(userId);
  const limitError = checkPerTxLimitSync(kycLevel, plan.price);
  if (limitError) { res.status(400).json({ error: limitError }); return; }

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, plan.price, `${plan.name} data for ${phone}`, "data", { network, phone, planId, plan }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  let sourceFunded = false;
  try {
    await fundBillSourceFromUser(userId, plan.price, tx.id);
    sourceFunded = true;
    const reference = flwReference(`DAT${tx.id}`);
    const result = await flwBuyData({ phone, amount: plan.wholesalePrice, itemCode: planId, billerName: plan.billerName, billerCode: plan.billerCode, reference });
    req.log.info({ flwStatus: result.raw?.status, flwMessage: result.raw?.message, flwData: result.raw?.data, reference, planId }, "Flutterwave data response");
    if (!result.success) {
      if (sourceFunded) await refundBillSourceToUser(userId, plan.price, tx.id);
      await refundFailed(userId, tx.id, plan.price, `Data delivery failed: ${result.message || "provider declined"}`, "data");
      res.status(502).json({
        error: "Data delivery failed. You have been refunded.",
        details: result.message,
        providerResponse: { status: result.raw?.status, message: result.raw?.message, data: result.raw?.data ?? null },
      });
      return;
    }
    await safePersist(req, tx.id, async () => {
      await db.update(transactionsTable).set({
        status: result.pending ? "pending" : "success",
        metadata: JSON.stringify({ network, phone, planId, plan, providerRef: result.flwRef ?? result.reference, providerStatus: result.message }),
      }).where(eq(transactionsTable.id, tx.id));
    });
    res.json({
      success: true,
      processing: result.pending === true,
      message: result.pending
        ? "Data purchase is still processing. You have not been charged any extra fee."
        : "Data delivered successfully",
      reference,
      transaction: formatTransaction({ ...tx, status: result.pending ? "pending" : "success" }),
    });
  } catch (e: any) {
    if (sourceFunded) await refundBillSourceToUser(userId, plan.price, tx.id);
    await refundFailed(userId, tx.id, plan.price, `Provider error: ${e.message ?? "unknown"}`, "data");
    res.status(502).json({ error: "Provider error. You have been refunded.", details: e.message });
  }
});

// ── BILLS ──────────────────────────────────────────────────────────────────
const BILL_CATEGORIES = [
  { id: "electricity", name: "Electricity", icon: "zap", description: "Prepaid & postpaid meter top-up across Nigeria" },
];

const BILL_PROVIDERS: Record<string, Array<{ id: string; name: string; code: string; category: string; minimumAmount: number | null; maximumAmount: number | null; description?: string }>> = {
  electricity: [
    { id: "ekedc", name: "Eko Electric (EKEDC)", code: "ekedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Lagos Island, Ajah, Lekki, Apapa" },
    { id: "ikedc", name: "Ikeja Electric (IKEDC)", code: "ikedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Ikeja, Agege, Oshodi, Shomolu" },
    { id: "aedc", name: "Abuja Electric (AEDC)", code: "aedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "FCT, Niger, Kogi, Nasarawa" },
    { id: "phedc", name: "Port Harcourt Electric (PHED)", code: "phedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Rivers, Bayelsa, Cross River, Akwa Ibom" },
    { id: "kedco", name: "Kano Electric (KEDCO)", code: "kedco", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Kano, Katsina, Jigawa" },
    { id: "enedco", name: "Enugu Electric (EEDC)", code: "enedco", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Enugu, Abia, Anambra, Ebonyi, Imo" },
    { id: "ibedc", name: "Ibadan Electric (IBEDC)", code: "ibedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Oyo, Ogun, Osun, Kwara" },
    { id: "jedc", name: "Jos Electric (JED)", code: "jedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Plateau, Bauchi, Benue, Gombe" },
    { id: "kaedc", name: "Kaduna Electric (KAEDCO)", code: "kaedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Kaduna, Kebbi, Sokoto, Zamfara" },
    { id: "yedc", name: "Yola Electric (YEDC)", code: "yedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Adamawa, Borno, Taraba, Yobe" },
    { id: "bedc", name: "Benin Electric (BEDC)", code: "bedc", category: "electricity", minimumAmount: 1000, maximumAmount: 500000, description: "Edo, Delta, Ondo, Ekiti" },
  ],
};

router.get("/bills/categories", (_req, res) => { res.json(BILL_CATEGORIES); });

router.get("/bills/providers", (req, res) => {
  const category = (req.query.category as string) ?? "";
  const providers = BILL_PROVIDERS[category] ?? [];
  res.json(providers.map(p => ({ ...p, logo: logoPath(p.id) })));
});

router.post("/bills/validate", async (req, res): Promise<void> => {
  const parsed = ValidateBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { provider, customerId, type } = parsed.data;
  const meterType: "prepaid" | "postpaid" = type === "postpaid" ? "postpaid" : "prepaid";

  // Electricity → Flutterwave (all 11 discos, prepaid/postpaid meter lookup).
  const flwElec = FLW_ELECTRICITY[provider];
  if (flwElec) {
    const item = flwElec[meterType];
    try {
      const result = await flwValidateBill({ biller: flwElec.biller, item, customer: customerId });
      if (!result.name) {
        res.status(400).json({ error: "Customer not found or invalid meter number" });
        return;
      }
      res.json({ name: result.name, customerId, provider, address: result.address ?? null, amount: null });
    } catch (e: any) {
      res.status(502).json({ error: "Verification failed", details: e.message });
    }
    return;
  }

  res.status(400).json({ error: "Provider not supported" });
});

router.post("/bills/pay", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = PayBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { provider, customerId, amount, customerName } = parsed.data;
  const rawMeterType = (req.body as any).meterType;
  const meterType: "prepaid" | "postpaid" = rawMeterType === "postpaid" ? "postpaid" : "prepaid";
  const flwElec = FLW_ELECTRICITY[provider];
  if (!flwElec) { res.status(400).json({ error: "Provider not supported" }); return; }

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, amount, `Bill payment - ${provider} (${customerId})${customerName ? ` - ${customerName}` : ""}`, "bill", { provider, customerId, amount, meterType }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  // Electricity → Flutterwave (amount-based, prepaid or postpaid).
  if (flwElec) {
    const item = flwElec[meterType];
    let sourceFunded = false;
    try {
      await fundBillSourceFromUser(userId, amount, tx.id);
      sourceFunded = true;
      const reference = flwReference(`BIL${tx.id}`);
      // Look up the live biller_name — POST /v3/bills requires `type` = biller_name, not biller code
      const billerName = await getElecBillerName(flwElec.biller, item);
      if (!billerName) {
        if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
        await refundFailed(userId, tx.id, amount, "Electricity biller not found in Flutterwave catalog", "bill");
        req.log.warn({ provider, biller: flwElec.biller, item }, "Electricity biller not found in catalog — cannot pay");
        res.status(502).json({ error: "Bill payment failed. You have been refunded.", details: "Biller not found in catalog" });
        return;
      }
      const result = await flwPayBill({ billerName, billerCode: flwElec.biller, item, customer: customerId, amount, reference });
      req.log.info({ flwStatus: result.raw?.status, flwMessage: result.raw?.message, flwRef: result.flwRef, reference, provider, item, billerName }, "Flutterwave electricity bill response");
      if (!result.success) {
        if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
        await refundFailed(userId, tx.id, amount, `Bill payment failed: ${result.message}`, "bill");
        // Surface actionable Flutterwave messages (min/max amount) directly; genericise the rest
        const rawMsg = result.message ?? "";
        const userMsg = /minimum amount|maximum amount|min.*amount|max.*amount/i.test(rawMsg)
          ? `${rawMsg}. You have been refunded.`
          : `Bill payment failed. You have been refunded.`;
        res.status(502).json({ error: userMsg, details: rawMsg, providerResponse: { status: result.raw?.status, message: result.raw?.message, data: result.raw?.data ?? null } });
        return;
      }
      // Poll Flutterwave for the prepaid token — bill status starts "pending" and
      // the token populates within a few seconds. Poll up to 4x with 2s gaps (≤8s total).
      let token: string | null = null;
      for (let attempt = 0; attempt < 4 && !token; attempt++) {
        if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 2000));
        try {
          const v = await flwVerifyBill(reference);
          token = v.raw?.data?.token ?? v.raw?.data?.extra ?? null;
        } catch { /* ignore — token may arrive via disco SMS instead */ }
      }
      const tokenPending = !token;
      await safePersist(req, tx.id, async () => {
        await db.update(transactionsTable).set({
          metadata: JSON.stringify({ provider, customerId, amount, token, tokenPending, providerRef: result.flwRef ?? result.reference }),
        }).where(eq(transactionsTable.id, tx.id));
      });
      res.json({
        success: true,
        message: token ? "Bill paid successfully. Your token is ready." : "Bill paid successfully. Your token will appear in the app shortly.",
        transaction: formatTransaction(tx),
        token,
        tokenPending,
        units: null,
      });
    } catch (e: any) {
      if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
      await refundFailed(userId, tx.id, amount, `Provider error: ${e.message ?? "unknown"}`, "bill");
      res.status(502).json({ error: "Provider error. You have been refunded.", details: e.message });
    }
    return;
  }

});

// ── SOCIAL ─────────────────────────────────────────────────────────────────
// Catalog mirrors the broad shape of what JAP exposes. The `keywords` on
// each service are the hints we hand to the JAP matcher at order time so
// it can pick the closest real provider service. Quality tiers are exposed
// to users so they can pick "Real / Premium / HQ" instead of getting one
// commodity option that ships look-alike usernames.
const SOCIAL_CATEGORIES = [
  { id: "followers",   name: "Followers",    icon: "users",         platforms: ["instagram", "tiktok", "twitter", "youtube", "facebook", "telegram", "threads", "snapchat", "linkedin", "pinterest"] },
  { id: "likes",       name: "Likes",        icon: "heart",         platforms: ["instagram", "tiktok", "twitter", "youtube", "facebook", "threads", "linkedin", "pinterest"] },
  { id: "views",       name: "Views",        icon: "eye",           platforms: ["instagram", "tiktok", "youtube", "twitter", "facebook", "telegram", "snapchat", "linkedin", "pinterest"] },
  { id: "comments",    name: "Comments",     icon: "message-circle",platforms: ["instagram", "tiktok", "youtube", "facebook", "threads", "linkedin"] },
  { id: "subscribers", name: "Subscribers",  icon: "bell",          platforms: ["youtube"] },
  { id: "shares",      name: "Shares",       icon: "share",         platforms: ["instagram", "tiktok", "facebook", "twitter", "threads"] },
  { id: "members",     name: "Members",      icon: "users",         platforms: ["telegram", "facebook"] },
  { id: "reactions",   name: "Reactions",    icon: "heart",         platforms: ["telegram", "facebook"] },
  { id: "saves",       name: "Saves",        icon: "bookmark",      platforms: ["instagram", "tiktok", "pinterest"] },
  { id: "story_views", name: "Story Views",  icon: "eye",           platforms: ["instagram", "facebook", "snapchat", "tiktok"] },
];

// Each service includes JAP keyword hints used to dynamically pick a real JAP service at order time.
const SOCIAL_SERVICES: Array<{
  id: string; name: string; platform: string; category: string;
  pricePerUnit: number; minQuantity: number; maxQuantity: number; unit: string;
  description: string; deliveryTime: string; quality: string;
  keywords: string[];
}> = [
  // ── Instagram ────────────────────────────────────────────────────────────
  { id: "ig-followers-real",     name: "Instagram Followers — Real",            platform: "instagram", category: "followers", pricePerUnit: 0.50, minQuantity: 100, maxQuantity: 50000,   unit: "followers", description: "Real-looking accounts with posts and profile pics. Gradual delivery.",         deliveryTime: "1-24 hours",  quality: "High Quality", keywords: ["instagram", "followers", "real"] },
  { id: "ig-followers-premium",  name: "Instagram Followers — Premium HQ",      platform: "instagram", category: "followers", pricePerUnit: 0.80, minQuantity: 100, maxQuantity: 100000,  unit: "followers", description: "Higher retention, active-looking accounts. 30-day refill guarantee.",          deliveryTime: "0-12 hours",  quality: "Premium",      keywords: ["instagram", "followers", "premium", "refill", "non drop"] },
  { id: "ig-followers-arab",     name: "Instagram Followers — Arab Real",       platform: "instagram", category: "followers", pricePerUnit: 1.20, minQuantity: 100, maxQuantity: 30000,   unit: "followers", description: "Real Arab/MENA region accounts. Slower, more authentic delivery.",            deliveryTime: "12-72 hours", quality: "Premium",      keywords: ["instagram", "followers", "arab", "real"] },
  { id: "ig-followers-cheap",    name: "Instagram Followers — Fast & Cheap",    platform: "instagram", category: "followers", pricePerUnit: 0.25, minQuantity: 100, maxQuantity: 200000,  unit: "followers", description: "Fast bulk delivery. Mixed-quality accounts, no refill.",                       deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["instagram", "followers", "cheap", "fast"] },
  { id: "ig-likes-real",         name: "Instagram Likes — Real",                platform: "instagram", category: "likes",     pricePerUnit: 0.30, minQuantity: 50,  maxQuantity: 100000,  unit: "likes",     description: "Real-looking likes for posts and reels.",                                      deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["instagram", "likes", "real"] },
  { id: "ig-likes-premium",      name: "Instagram Likes — Premium",             platform: "instagram", category: "likes",     pricePerUnit: 0.60, minQuantity: 50,  maxQuantity: 100000,  unit: "likes",     description: "High retention likes from real-looking active accounts.",                      deliveryTime: "0-1 hour",    quality: "Premium",      keywords: ["instagram", "likes", "premium", "real"] },
  { id: "ig-likes-reel",         name: "Instagram Reel Likes",                  platform: "instagram", category: "likes",     pricePerUnit: 0.35, minQuantity: 50,  maxQuantity: 100000,  unit: "likes",     description: "Likes specifically for Reels.",                                                deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["instagram", "reel", "likes"] },
  { id: "ig-views-reel",         name: "Instagram Reel Views",                  platform: "instagram", category: "views",     pricePerUnit: 0.08, minQuantity: 1000,maxQuantity: 10000000,unit: "views",     description: "Reel views, instant start.",                                                   deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["instagram", "reels", "views"] },
  { id: "ig-views-video",        name: "Instagram Video Views",                 platform: "instagram", category: "views",     pricePerUnit: 0.10, minQuantity: 1000,maxQuantity: 10000000,unit: "views",     description: "Views for regular feed videos and IGTV.",                                       deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["instagram", "video", "views"] },
  { id: "ig-story-views",        name: "Instagram Story Views",                 platform: "instagram", category: "story_views", pricePerUnit: 0.40, minQuantity: 100, maxQuantity: 100000, unit: "views",   description: "Views on all active stories on the profile.",                                  deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["instagram", "story", "views"] },
  { id: "ig-saves",              name: "Instagram Post Saves",                  platform: "instagram", category: "saves",     pricePerUnit: 0.20, minQuantity: 50,  maxQuantity: 50000,   unit: "saves",     description: "Saves to boost post discoverability.",                                          deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["instagram", "saves", "bookmark"] },
  { id: "ig-comments-random",    name: "Instagram Comments — Random",           platform: "instagram", category: "comments",  pricePerUnit: 2.50, minQuantity: 20,  maxQuantity: 1000,    unit: "comments",  description: "Random positive comments (emoji + short text).",                                deliveryTime: "1-12 hours",  quality: "Standard",     keywords: ["instagram", "comments", "random", "emoji"] },
  { id: "ig-comments-custom",    name: "Instagram Comments — Custom",           platform: "instagram", category: "comments",  pricePerUnit: 5.00, minQuantity: 20,  maxQuantity: 1000,    unit: "comments",  description: "Your exact text, one comment per line.",                                       deliveryTime: "1-48 hours",  quality: "Premium",      keywords: ["instagram", "custom", "comments"] },

  // ── TikTok ────────────────────────────────────────────────────────────────
  { id: "tt-followers-real",     name: "TikTok Followers — Real",               platform: "tiktok", category: "followers", pricePerUnit: 0.40, minQuantity: 100, maxQuantity: 100000,  unit: "followers", description: "Real-looking followers from active TikTok accounts. Some drop possible.",      deliveryTime: "1-24 hours",  quality: "High Quality", keywords: ["tiktok", "followers", "real"] },
  { id: "tt-followers-premium",  name: "TikTok Followers — Premium (Non-drop)", platform: "tiktok", category: "followers", pricePerUnit: 0.90, minQuantity: 100, maxQuantity: 50000,   unit: "followers", description: "Premium real accounts, non-drop, 60-day refill guarantee. Best for clean look.", deliveryTime: "1-12 hours",  quality: "Premium",      keywords: ["tiktok", "followers", "premium", "non drop", "refill"] },
  { id: "tt-followers-usa",      name: "TikTok Followers — Real USA",           platform: "tiktok", category: "followers", pricePerUnit: 1.50, minQuantity: 100, maxQuantity: 20000,   unit: "followers", description: "Real USA-based TikTok accounts. Slower, very authentic.",                      deliveryTime: "12-72 hours", quality: "Premium",      keywords: ["tiktok", "followers", "usa", "real"] },
  { id: "tt-followers-arab",     name: "TikTok Followers — Real Arab",          platform: "tiktok", category: "followers", pricePerUnit: 1.20, minQuantity: 100, maxQuantity: 20000,   unit: "followers", description: "Real Arab/MENA region TikTok accounts.",                                       deliveryTime: "12-72 hours", quality: "Premium",      keywords: ["tiktok", "followers", "arab", "real"] },
  { id: "tt-followers-cheap",    name: "TikTok Followers — Fast & Cheap",       platform: "tiktok", category: "followers", pricePerUnit: 0.22, minQuantity: 100, maxQuantity: 500000,  unit: "followers", description: "Fast bulk delivery — usernames may look similar. No refill.",                  deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["tiktok", "followers", "cheap", "fast", "bot"] },
  { id: "tt-likes-real",         name: "TikTok Likes — Real",                   platform: "tiktok", category: "likes",     pricePerUnit: 0.18, minQuantity: 100, maxQuantity: 500000,  unit: "likes",     description: "Real-looking likes on TikTok videos.",                                          deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["tiktok", "likes", "real"] },
  { id: "tt-likes-premium",      name: "TikTok Likes — Premium",                platform: "tiktok", category: "likes",     pricePerUnit: 0.40, minQuantity: 100, maxQuantity: 100000,  unit: "likes",     description: "Premium real-user likes with high retention.",                                  deliveryTime: "0-1 hour",    quality: "Premium",      keywords: ["tiktok", "likes", "premium"] },
  { id: "tt-views-real",         name: "TikTok Views — Fast",                   platform: "tiktok", category: "views",     pricePerUnit: 0.03, minQuantity: 1000,maxQuantity: 50000000,unit: "views",     description: "Fast video views, instant start.",                                              deliveryTime: "0-30 min",    quality: "Standard",     keywords: ["tiktok", "views", "fast"] },
  { id: "tt-views-live",         name: "TikTok Live Stream Views",              platform: "tiktok", category: "views",     pricePerUnit: 0.20, minQuantity: 100, maxQuantity: 50000,   unit: "viewers",   description: "Live viewers for the duration of your stream (15-60 min).",                     deliveryTime: "On demand",   quality: "Premium",      keywords: ["tiktok", "live", "viewers", "stream"] },
  { id: "tt-comments-random",    name: "TikTok Comments — Random",              platform: "tiktok", category: "comments",  pricePerUnit: 2.00, minQuantity: 20,  maxQuantity: 1000,    unit: "comments",  description: "Random positive comments on a TikTok video.",                                   deliveryTime: "1-12 hours",  quality: "Standard",     keywords: ["tiktok", "comments", "random"] },
  { id: "tt-comments-custom",    name: "TikTok Comments — Custom",              platform: "tiktok", category: "comments",  pricePerUnit: 4.50, minQuantity: 20,  maxQuantity: 1000,    unit: "comments",  description: "Your exact comments, one per line.",                                            deliveryTime: "1-48 hours",  quality: "Premium",      keywords: ["tiktok", "custom", "comments"] },
  { id: "tt-shares",             name: "TikTok Video Shares",                   platform: "tiktok", category: "shares",    pricePerUnit: 0.05, minQuantity: 100, maxQuantity: 100000,  unit: "shares",    description: "Shares to boost FYP signals.",                                                  deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["tiktok", "shares"] },
  { id: "tt-saves",              name: "TikTok Video Saves",                    platform: "tiktok", category: "saves",     pricePerUnit: 0.08, minQuantity: 100, maxQuantity: 100000,  unit: "saves",     description: "Saves on TikTok videos.",                                                       deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["tiktok", "saves", "favorites"] },

  // ── YouTube ───────────────────────────────────────────────────────────────
  { id: "yt-subscribers",        name: "YouTube Subscribers — Real",            platform: "youtube", category: "subscribers", pricePerUnit: 2.00, minQuantity: 50,  maxQuantity: 10000, unit: "subscribers", description: "Real-looking subscribers. Slow gradual delivery, monetization-safe.",          deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["youtube", "subscribers", "real"] },
  { id: "yt-subscribers-premium",name: "YouTube Subscribers — Premium",         platform: "youtube", category: "subscribers", pricePerUnit: 4.00, minQuantity: 50,  maxQuantity: 5000,  unit: "subscribers", description: "Premium active subs, 60-day refill, monetization-safe.",                      deliveryTime: "24-120 hours",quality: "Premium",      keywords: ["youtube", "subscribers", "premium", "refill"] },
  { id: "yt-views-real",         name: "YouTube Views — High Retention",        platform: "youtube", category: "views",     pricePerUnit: 0.30, minQuantity: 500, maxQuantity: 1000000, unit: "views",     description: "Real views with 50%+ retention — best for the algorithm.",                     deliveryTime: "1-48 hours",  quality: "High Quality", keywords: ["youtube", "views", "retention", "real"] },
  { id: "yt-views-cheap",        name: "YouTube Views — Fast",                  platform: "youtube", category: "views",     pricePerUnit: 0.12, minQuantity: 500, maxQuantity: 5000000, unit: "views",     description: "Fast views, lower retention. Good for vanity counts.",                          deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["youtube", "views", "fast", "cheap"] },
  { id: "yt-views-shorts",       name: "YouTube Shorts Views",                  platform: "youtube", category: "views",     pricePerUnit: 0.08, minQuantity: 1000,maxQuantity: 5000000, unit: "views",     description: "Views specifically for YouTube Shorts.",                                       deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["youtube", "shorts", "views"] },
  { id: "yt-watch-hours",        name: "YouTube Watch Hours (for monetization)",platform: "youtube", category: "views",     pricePerUnit: 25.00,minQuantity: 100, maxQuantity: 4000,   unit: "hours",     description: "Real watch hours from long videos to hit the 4,000-hour requirement.",         deliveryTime: "7-30 days",   quality: "Premium",      keywords: ["youtube", "watch", "hours", "monetization"] },
  { id: "yt-likes",              name: "YouTube Likes",                         platform: "youtube", category: "likes",     pricePerUnit: 0.80, minQuantity: 50,  maxQuantity: 50000,  unit: "likes",     description: "Likes for YouTube videos.",                                                     deliveryTime: "1-24 hours",  quality: "High Quality", keywords: ["youtube", "likes"] },
  { id: "yt-likes-shorts",       name: "YouTube Shorts Likes",                  platform: "youtube", category: "likes",     pricePerUnit: 0.60, minQuantity: 50,  maxQuantity: 50000,  unit: "likes",     description: "Likes for YouTube Shorts.",                                                     deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["youtube", "shorts", "likes"] },
  { id: "yt-comments-random",    name: "YouTube Comments — Random",             platform: "youtube", category: "comments",  pricePerUnit: 4.00, minQuantity: 20,  maxQuantity: 1000,   unit: "comments",  description: "Random positive comments on a YouTube video.",                                  deliveryTime: "1-24 hours",  quality: "Standard",     keywords: ["youtube", "comments", "random"] },
  { id: "yt-comments-custom",    name: "YouTube Comments — Custom",             platform: "youtube", category: "comments",  pricePerUnit: 8.00, minQuantity: 20,  maxQuantity: 500,    unit: "comments",  description: "Your exact comments, one per line.",                                            deliveryTime: "1-48 hours",  quality: "Premium",      keywords: ["youtube", "custom", "comments"] },

  // ── Twitter / X ───────────────────────────────────────────────────────────
  { id: "tw-followers-real",     name: "Twitter/X Followers — Real",            platform: "twitter", category: "followers", pricePerUnit: 0.80, minQuantity: 100, maxQuantity: 50000,  unit: "followers", description: "Real-looking Twitter/X followers, gradual delivery.",                          deliveryTime: "1-48 hours",  quality: "High Quality", keywords: ["twitter", "x", "followers", "real"] },
  { id: "tw-followers-premium",  name: "Twitter/X Followers — Premium",         platform: "twitter", category: "followers", pricePerUnit: 1.40, minQuantity: 100, maxQuantity: 20000,  unit: "followers", description: "Premium accounts with posts and bios. 30-day refill.",                         deliveryTime: "1-24 hours",  quality: "Premium",      keywords: ["twitter", "x", "followers", "premium", "refill"] },
  { id: "tw-likes-real",         name: "Twitter/X Likes",                       platform: "twitter", category: "likes",     pricePerUnit: 0.45, minQuantity: 50,  maxQuantity: 100000, unit: "likes",     description: "Likes for tweets.",                                                             deliveryTime: "0-4 hours",   quality: "Standard",     keywords: ["twitter", "x", "likes"] },
  { id: "tw-retweets",           name: "Twitter/X Retweets",                    platform: "twitter", category: "shares",    pricePerUnit: 0.60, minQuantity: 25,  maxQuantity: 50000,  unit: "retweets",  description: "Retweets to boost reach.",                                                      deliveryTime: "0-6 hours",   quality: "High Quality", keywords: ["twitter", "x", "retweets", "shares"] },
  { id: "tw-views",              name: "Twitter/X Video Views",                 platform: "twitter", category: "views",     pricePerUnit: 0.05, minQuantity: 1000,maxQuantity: 5000000,unit: "views",     description: "Video impressions on Twitter/X.",                                               deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["twitter", "x", "video", "views", "impressions"] },
  { id: "tw-impressions",        name: "Twitter/X Post Impressions",            platform: "twitter", category: "views",     pricePerUnit: 0.04, minQuantity: 1000,maxQuantity: 10000000,unit: "impressions", description: "Boost post impression count.",                                              deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["twitter", "x", "impressions"] },

  // ── Facebook ──────────────────────────────────────────────────────────────
  { id: "fb-page-likes",         name: "Facebook Page Likes",                   platform: "facebook", category: "likes",    pricePerUnit: 0.60, minQuantity: 100, maxQuantity: 50000,  unit: "likes",     description: "Likes/follows on a Facebook page.",                                             deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["facebook", "page", "likes"] },
  { id: "fb-post-likes",         name: "Facebook Post Likes",                   platform: "facebook", category: "likes",    pricePerUnit: 0.25, minQuantity: 50,  maxQuantity: 50000,  unit: "likes",     description: "Likes on a single Facebook post.",                                              deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["facebook", "post", "likes"] },
  { id: "fb-reactions-love",     name: "Facebook Post Reactions — Love/Wow/Haha",platform: "facebook",category: "reactions", pricePerUnit: 0.50, minQuantity: 50,  maxQuantity: 20000,  unit: "reactions", description: "Pick your reaction type when ordering (love/wow/haha/sad/angry).",              deliveryTime: "0-12 hours",  quality: "High Quality", keywords: ["facebook", "reactions", "love", "wow"] },
  { id: "fb-followers",          name: "Facebook Profile Followers",            platform: "facebook", category: "followers",pricePerUnit: 0.50, minQuantity: 100, maxQuantity: 50000,  unit: "followers", description: "Followers for a personal Facebook profile.",                                    deliveryTime: "24-72 hours", quality: "Standard",     keywords: ["facebook", "profile", "followers"] },
  { id: "fb-group-members",      name: "Facebook Group Members",                platform: "facebook", category: "members",  pricePerUnit: 1.20, minQuantity: 100, maxQuantity: 10000,  unit: "members",   description: "Real members for a public Facebook group.",                                     deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["facebook", "group", "members"] },
  { id: "fb-video-views",        name: "Facebook Video Views",                  platform: "facebook", category: "views",    pricePerUnit: 0.12, minQuantity: 500, maxQuantity: 5000000,unit: "views",     description: "Views on Facebook videos and Reels.",                                           deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["facebook", "video", "views"] },
  { id: "fb-story-views",        name: "Facebook Story Views",                  platform: "facebook", category: "story_views", pricePerUnit: 0.30, minQuantity: 100, maxQuantity: 20000, unit: "views",  description: "Views on Facebook stories.",                                                    deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["facebook", "story", "views"] },
  { id: "fb-comments",           name: "Facebook Post Comments — Random",       platform: "facebook", category: "comments", pricePerUnit: 3.00, minQuantity: 20,  maxQuantity: 1000,   unit: "comments",  description: "Random positive comments on a Facebook post.",                                  deliveryTime: "1-24 hours",  quality: "Standard",     keywords: ["facebook", "comments", "random"] },
  { id: "fb-shares",             name: "Facebook Post Shares",                  platform: "facebook", category: "shares",   pricePerUnit: 0.40, minQuantity: 25,  maxQuantity: 20000,  unit: "shares",    description: "Shares on a Facebook post.",                                                    deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["facebook", "post", "shares"] },

  // ── Telegram ──────────────────────────────────────────────────────────────
  { id: "tg-channel-members",    name: "Telegram Channel Members — Real",       platform: "telegram", category: "members",  pricePerUnit: 0.80, minQuantity: 100, maxQuantity: 100000, unit: "members",   description: "Real members for a Telegram channel. Some drop expected.",                      deliveryTime: "0-12 hours",  quality: "High Quality", keywords: ["telegram", "channel", "members", "subscribers"] },
  { id: "tg-channel-premium",    name: "Telegram Channel Members — Premium",    platform: "telegram", category: "members",  pricePerUnit: 1.50, minQuantity: 100, maxQuantity: 50000,  unit: "members",   description: "Premium high-retention channel members. 30-day refill.",                        deliveryTime: "1-24 hours",  quality: "Premium",      keywords: ["telegram", "channel", "members", "premium", "refill"] },
  { id: "tg-group-members",      name: "Telegram Group Members — Real",         platform: "telegram", category: "members",  pricePerUnit: 0.90, minQuantity: 100, maxQuantity: 50000,  unit: "members",   description: "Real members joining your Telegram group.",                                     deliveryTime: "0-24 hours",  quality: "High Quality", keywords: ["telegram", "group", "members"] },
  { id: "tg-group-premium",      name: "Telegram Group Members — Premium",      platform: "telegram", category: "members",  pricePerUnit: 1.80, minQuantity: 100, maxQuantity: 20000,  unit: "members",   description: "Premium real group members with profile pics, 30-day refill.",                  deliveryTime: "1-48 hours",  quality: "Premium",      keywords: ["telegram", "group", "members", "premium", "real"] },
  { id: "tg-post-views",         name: "Telegram Post Views (last 5 posts)",    platform: "telegram", category: "views",    pricePerUnit: 0.02, minQuantity: 100, maxQuantity: 1000000,unit: "views",     description: "Views split across the last 5 posts of your channel.",                          deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["telegram", "views", "post", "channel"] },
  { id: "tg-post-views-1",       name: "Telegram Post Views (single post)",     platform: "telegram", category: "views",    pricePerUnit: 0.04, minQuantity: 100, maxQuantity: 500000, unit: "views",     description: "Views on a single specific Telegram post.",                                     deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["telegram", "views", "single", "post"] },
  { id: "tg-reactions-positive", name: "Telegram Post Reactions — Positive Mix",platform: "telegram", category: "reactions",pricePerUnit: 0.30, minQuantity: 50,  maxQuantity: 50000,  unit: "reactions", description: "Mixed positive reactions (👍 ❤️ 🔥 🎉 👏).",                                    deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["telegram", "reactions", "positive"] },
  { id: "tg-reactions-fire",     name: "Telegram Reactions — 🔥 Fire only",     platform: "telegram", category: "reactions",pricePerUnit: 0.35, minQuantity: 50,  maxQuantity: 50000,  unit: "reactions", description: "Only 🔥 fire reactions on a single post.",                                       deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["telegram", "reactions", "fire"] },
  { id: "tg-group-targeted",     name: "Telegram Group Members — Targeted",      platform: "telegram", category: "members",  pricePerUnit: 3.50, minQuantity: 100, maxQuantity: 10000,  unit: "members",   description: "Targeted active members from related channels in your niche.",                  deliveryTime: "24-72 hours", quality: "Premium",      keywords: ["telegram", "group", "members", "targeted", "active"] },
  { id: "tg-channel-fast",       name: "Telegram Channel Members — Fast",        platform: "telegram", category: "members",  pricePerUnit: 0.50, minQuantity: 100, maxQuantity: 200000, unit: "members",   description: "Fast bulk channel subscribers — no refill, good for count boost.",              deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["telegram", "channel", "members", "fast", "cheap"] },
  { id: "tg-views-auto",         name: "Telegram Auto Views (30 future posts)",  platform: "telegram", category: "views",    pricePerUnit: 0.10, minQuantity: 100, maxQuantity: 100000, unit: "views",     description: "Auto-views on the next 30 posts you publish.",                                  deliveryTime: "Ongoing",     quality: "Standard",     keywords: ["telegram", "auto", "views", "auto views"] },
  { id: "tg-reactions-heart",    name: "Telegram Reactions — ❤️ Heart only",     platform: "telegram", category: "reactions",pricePerUnit: 0.35, minQuantity: 50,  maxQuantity: 50000,  unit: "reactions", description: "Only ❤️ heart reactions on a single post.",                                       deliveryTime: "0-2 hours",   quality: "High Quality", keywords: ["telegram", "reactions", "heart", "love"] },

  // ── TikTok Extra Quality Tiers ────────────────────────────────────────────
  // NOTE: The "Fast & Cheap" tier is bulk bot accounts — usernames often look similar.
  // Use "Real", "Premium" or targeted tiers for natural-looking followers.
  { id: "tt-followers-indian",   name: "TikTok Followers — Real Indian",         platform: "tiktok", category: "followers", pricePerUnit: 0.80, minQuantity: 100, maxQuantity: 30000,   unit: "followers", description: "Real Indian TikTok accounts with varied usernames and profile pics.",          deliveryTime: "12-72 hours", quality: "Premium",      keywords: ["tiktok", "followers", "indian", "real"] },
  { id: "tt-followers-nigerian", name: "TikTok Followers — Real Nigerian/African",platform: "tiktok", category: "followers", pricePerUnit: 1.00, minQuantity: 100, maxQuantity: 20000,   unit: "followers", description: "Real African TikTok accounts. Unique profiles, varied names.",                 deliveryTime: "12-72 hours", quality: "Premium",      keywords: ["tiktok", "followers", "african", "nigeria", "real"] },
  { id: "tt-followers-global",   name: "TikTok Followers — Global Mix HQ",       platform: "tiktok", category: "followers", pricePerUnit: 0.60, minQuantity: 100, maxQuantity: 100000,  unit: "followers", description: "Mixed global real accounts — diverse usernames and countries.",                deliveryTime: "6-48 hours",  quality: "High Quality", keywords: ["tiktok", "followers", "real", "mix", "global", "worldwide"] },
  { id: "tt-followers-female",   name: "TikTok Followers — Female Accounts",     platform: "tiktok", category: "followers", pricePerUnit: 1.20, minQuantity: 100, maxQuantity: 20000,   unit: "followers", description: "Female-presenting TikTok accounts with real bios and photos.",                deliveryTime: "24-72 hours", quality: "Premium",      keywords: ["tiktok", "followers", "female", "women", "girl"] },
  { id: "tt-profile-views",      name: "TikTok Profile Views",                   platform: "tiktok", category: "views",     pricePerUnit: 0.01, minQuantity: 1000,maxQuantity: 5000000, unit: "views",     description: "Boost your TikTok profile view count.",                                        deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["tiktok", "profile", "views"] },
  { id: "tt-story-views",        name: "TikTok Story Views",                     platform: "tiktok", category: "views",     pricePerUnit: 0.05, minQuantity: 500, maxQuantity: 1000000, unit: "views",     description: "Views on your TikTok story.",                                                   deliveryTime: "0-1 hour",    quality: "Standard",     keywords: ["tiktok", "story", "views"] },
  { id: "tt-followers-slow",     name: "TikTok Followers — Drip-feed (30 days)", platform: "tiktok", category: "followers", pricePerUnit: 1.50, minQuantity: 100, maxQuantity: 30000,   unit: "followers", description: "Followers drip over 30 days for a natural organic look.",                      deliveryTime: "Gradual 30d", quality: "Premium",      keywords: ["tiktok", "followers", "drip", "slow", "gradual"] },

  // ── Threads (Meta) ────────────────────────────────────────────────────────
  { id: "threads-followers-real",  name: "Threads Followers — Real",             platform: "threads", category: "followers", pricePerUnit: 1.00, minQuantity: 100, maxQuantity: 50000,  unit: "followers", description: "Real Threads followers from active Instagram-linked accounts.",               deliveryTime: "12-48 hours", quality: "High Quality", keywords: ["threads", "followers", "real"] },
  { id: "threads-followers-premium",name: "Threads Followers — Premium",         platform: "threads", category: "followers", pricePerUnit: 2.00, minQuantity: 100, maxQuantity: 20000,  unit: "followers", description: "Premium HQ Threads followers with profile pictures and bios.",               deliveryTime: "24-72 hours", quality: "Premium",      keywords: ["threads", "followers", "premium", "hq"] },
  { id: "threads-likes",           name: "Threads Post Likes",                   platform: "threads", category: "likes",     pricePerUnit: 0.50, minQuantity: 50,  maxQuantity: 50000,  unit: "likes",     description: "Likes on a Threads post.",                                                     deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["threads", "likes", "post"] },
  { id: "threads-replies",         name: "Threads Post Replies",                 platform: "threads", category: "comments",  pricePerUnit: 3.00, minQuantity: 20,  maxQuantity: 1000,   unit: "replies",   description: "Random positive replies on your Threads post.",                                deliveryTime: "1-24 hours",  quality: "Standard",     keywords: ["threads", "comments", "replies", "random"] },
  { id: "threads-reposts",         name: "Threads Reposts",                      platform: "threads", category: "shares",    pricePerUnit: 0.80, minQuantity: 25,  maxQuantity: 20000,  unit: "reposts",   description: "Reposts/shares of your Threads post.",                                         deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["threads", "reposts", "shares"] },

  // ── Snapchat ──────────────────────────────────────────────────────────────
  { id: "sc-followers",          name: "Snapchat Followers",                     platform: "snapchat", category: "followers", pricePerUnit: 1.20, minQuantity: 100, maxQuantity: 20000, unit: "followers", description: "Snapchat followers for your public profile.",                                  deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["snapchat", "followers"] },
  { id: "sc-views",              name: "Snapchat Story Views",                   platform: "snapchat", category: "views",     pricePerUnit: 0.15, minQuantity: 500, maxQuantity: 500000,unit: "views",     description: "Views on Snapchat stories.",                                                   deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["snapchat", "story", "views"] },
  { id: "sc-spotlight-views",    name: "Snapchat Spotlight Views",               platform: "snapchat", category: "views",     pricePerUnit: 0.08, minQuantity: 1000,maxQuantity: 1000000,unit: "views",    description: "Views on Snapchat Spotlight videos.",                                          deliveryTime: "0-2 hours",   quality: "Standard",     keywords: ["snapchat", "spotlight", "views"] },

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  { id: "li-followers",          name: "LinkedIn Followers",                     platform: "linkedin", category: "followers", pricePerUnit: 2.00, minQuantity: 50,  maxQuantity: 20000, unit: "followers", description: "LinkedIn profile/page followers.",                                             deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["linkedin", "followers"] },
  { id: "li-connections",        name: "LinkedIn Connections",                   platform: "linkedin", category: "followers", pricePerUnit: 3.00, minQuantity: 20,  maxQuantity: 5000,  unit: "connections",description: "LinkedIn connections from real-looking professional accounts.",              deliveryTime: "24-96 hours", quality: "High Quality", keywords: ["linkedin", "connections", "connect"] },
  { id: "li-post-likes",         name: "LinkedIn Post Likes",                    platform: "linkedin", category: "likes",     pricePerUnit: 1.50, minQuantity: 20,  maxQuantity: 10000, unit: "likes",     description: "Likes on a LinkedIn post from professional-looking accounts.",                 deliveryTime: "0-12 hours",  quality: "High Quality", keywords: ["linkedin", "post", "likes"] },
  { id: "li-post-views",         name: "LinkedIn Post Impressions",              platform: "linkedin", category: "views",     pricePerUnit: 0.20, minQuantity: 500, maxQuantity: 500000,unit: "impressions",description: "Impressions/views on a LinkedIn post.",                                      deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["linkedin", "impressions", "views", "post"] },
  { id: "li-comments",           name: "LinkedIn Post Comments",                 platform: "linkedin", category: "comments",  pricePerUnit: 8.00, minQuantity: 20,   maxQuantity: 500,   unit: "comments",  description: "Professional-looking comments on your LinkedIn post.",                         deliveryTime: "1-48 hours",  quality: "Premium",      keywords: ["linkedin", "comments", "post"] },

  // ── Pinterest ─────────────────────────────────────────────────────────────
  { id: "pin-followers",         name: "Pinterest Followers",                    platform: "pinterest", category: "followers", pricePerUnit: 0.80, minQuantity: 100, maxQuantity: 50000, unit: "followers", description: "Pinterest profile followers.",                                                deliveryTime: "24-72 hours", quality: "High Quality", keywords: ["pinterest", "followers"] },
  { id: "pin-saves",             name: "Pinterest Pin Saves (Repins)",           platform: "pinterest", category: "saves",     pricePerUnit: 0.40, minQuantity: 50,  maxQuantity: 20000, unit: "saves",     description: "Saves/repins on a Pinterest pin.",                                             deliveryTime: "0-12 hours",  quality: "Standard",     keywords: ["pinterest", "repins", "saves", "pin"] },
  { id: "pin-views",             name: "Pinterest Pin Impressions",              platform: "pinterest", category: "views",     pricePerUnit: 0.05, minQuantity: 1000,maxQuantity: 1000000,unit: "impressions",description: "Impressions/views on a Pinterest pin.",                                     deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["pinterest", "impressions", "views"] },
  { id: "pin-likes",             name: "Pinterest Pin Likes",                    platform: "pinterest", category: "likes",     pricePerUnit: 0.30, minQuantity: 50,  maxQuantity: 50000, unit: "likes",     description: "Likes on a Pinterest pin.",                                                    deliveryTime: "0-6 hours",   quality: "Standard",     keywords: ["pinterest", "likes", "pin"] },
];

router.get("/social/categories", (_req, res) => { res.json(SOCIAL_CATEGORIES); });

router.get("/social/services", (req, res) => {
  const { category, platform } = req.query as { category?: string; platform?: string };
  let services: any[] = SOCIAL_SERVICES.map(({ keywords: _k, ...rest }) => rest);
  if (category) services = services.filter(s => s.category === category);
  if (platform) services = services.filter(s => s.platform === platform);
  res.json(services);
});

router.post("/social/order", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = PlaceSocialOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { serviceId, link, quantity } = parsed.data;
  const service = SOCIAL_SERVICES.find(s => s.id === serviceId);
  if (!service) { res.status(400).json({ error: "Service not found" }); return; }
  if (quantity < service.minQuantity || quantity > service.maxQuantity) {
    res.status(400).json({ error: `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}` });
    return;
  }

  const providerAmount = service.pricePerUnit * quantity;
  const amount = providerAmount + 200;

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, amount, `${service.name} x${quantity} - ${link}`, "social", { serviceId, link, quantity, providerAmount, cipherPayProfit: 200 }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  let sourceFunded = false;
  try {
    await fundBillSourceFromUser(userId, amount, tx.id);
    sourceFunded = true;
    const sociallyService = await smmFindService(service.keywords, quantity);
    if (!sociallyService) {
      if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
      await refundFailed(userId, tx.id, amount, `No socially.ng service matches "${service.keywords.join(" ")}" for quantity ${quantity}`, "social");
      res.status(502).json({ error: "No matching provider service available right now. You have been refunded." });
      return;
    }

    const result = await smmAddOrder({ service: sociallyService.service, link, quantity });
    if (!result.ok || !result.orderId) {
      if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
      await refundFailed(userId, tx.id, amount, `Social order failed: ${result.error ?? "unknown"}`, "social");
      res.status(502).json({ error: `Social order failed. You have been refunded.`, details: result.error });
      return;
    }

    // Provider has accepted the order. Persist locally — never refund if this fails.
    let order: any = null;
    await safePersist(req, tx.id, async () => {
      [order] = await db.insert(socialOrdersTable).values({
        userId, serviceId, serviceName: service.name, platform: service.platform,
        link, quantity, amount: amount.toFixed(2), status: "processing",
        startCount: 0, remainsCount: quantity, transactionId: tx.id,
        externalOrderId: String(result.orderId),
      }).returning();
    });
    res.json({
      success: true,
      message: "Order placed successfully",
      order: order
        ? { ...order, amount: parseFloat(order.amount), createdAt: order.createdAt.toISOString(), externalOrderId: order.externalOrderId ?? null }
        : { externalOrderId: String(result.orderId), status: "processing", amount, quantity, link, serviceId, transactionId: tx.id },
    });
  } catch (e: any) {
    if (sourceFunded) await refundBillSourceToUser(userId, amount, tx.id);
    await refundFailed(userId, tx.id, amount, `Provider error: ${e.message ?? "unknown"}`, "social");
    res.status(502).json({ error: "Provider error. You have been refunded.", details: e.message });
  }
});

router.get("/social/orders", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "20", 10);
  const offset = (page - 1) * limit;

  const data = await db.select().from(socialOrdersTable).where(eq(socialOrdersTable.userId, userId))
    .orderBy(socialOrdersTable.createdAt).limit(limit).offset(offset);
  res.json({
    data: data.map(o => ({ ...o, amount: parseFloat(o.amount), createdAt: o.createdAt.toISOString(), externalOrderId: o.externalOrderId ?? null })),
    total: data.length, page, limit,
  });
});

router.get("/social/orders/:id/status", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [order] = await db.select().from(socialOrdersTable).where(eq(socialOrdersTable.id, id));
  if (!order || order.userId !== userId) { res.status(404).json({ error: "Order not found" }); return; }

  // Refresh status from the live fulfilment partner if we have an external id.
  if (order.externalOrderId) {
    try {
      const live = await smmOrderStatus(order.externalOrderId);
      const statusMap: Record<string, string> = {
        pending: "pending", "in progress": "processing", processing: "processing",
        completed: "completed", partial: "partial", canceled: "cancelled", cancelled: "cancelled",
      };
      const liveKey = live.status?.toLowerCase();
      const newStatus = liveKey ? (statusMap[liveKey] ?? order.status) : order.status;
      const remains = live.remains != null ? Number(live.remains) : order.remainsCount;
      const startCount = live.start_count != null ? Number(live.start_count) : order.startCount;
      await db.update(socialOrdersTable).set({ status: newStatus, remainsCount: remains, startCount }).where(eq(socialOrdersTable.id, id));
      order.status = newStatus; order.remainsCount = remains; order.startCount = startCount;
    } catch {
      // Keep the last known state when the partner is temporarily unreachable.
      // A failed status check must never be treated as a failed order.
    }
  }

  res.json({ ...order, amount: parseFloat(order.amount), createdAt: order.createdAt.toISOString(), externalOrderId: order.externalOrderId ?? null });
});

// ── SMSPool verification numbers ─────────────────────────────────────────────
// Convert an ISO-3166 alpha-2 code into its flag emoji (best-effort, for nicer UI).
function isoToFlag(code?: string): string {
  if (!code || code.length !== 2 || !/^[a-zA-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  const cc = code.toUpperCase();
  return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65));
}

function smsPurchaseUserMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (/OUT_OF_STOCK/i.test(detail)) {
    return "No numbers are currently available for this service. Please try again later. You have been refunded.";
  }
  if (/PRICE_NOT_FOUND/i.test(detail)) {
    return "The price for this service changed before checkout. Please try again. You have been refunded.";
  }
  if (/5 minutes|ran into an? error|temporarily unavailable/i.test(detail)) {
    return "This service is temporarily unavailable. Please try again in 5 minutes. You have been refunded.";
  }
  return "This service could not be completed right now. Please try again later. You have been refunded.";
}

router.get("/sms/countries", async (_req, res): Promise<void> => {
  try {
    const countries = await listSmsPoolCountries();
    res.json(countries.map(country => ({
      code: country.id,
      name: country.name,
      prefix: "",
      flag: isoToFlag(country.iso),
    })));
  } catch {
    res.status(502).json({ error: "Could not load countries right now. Please try again." });
  }
});

// Live service offers and wallet prices for a given SMSPool country ID.
router.get("/sms/services", async (req, res): Promise<void> => {
  const country = (req.query.country as string) ?? "";
  if (!country) { res.json([]); return; }
  try {
    const [offers, rate] = await Promise.all([
      listSmsPoolOffers(country),
      getSmsPoolNgnPerUsd(),
    ]);
    const cheapestByService = new Map<string, (typeof offers)[number]>();
    for (const offer of offers) {
      const previous = cheapestByService.get(offer.serviceId);
      if (!previous || offer.priceUsd < previous.priceUsd) cheapestByService.set(offer.serviceId, offer);
    }
    res.json([...cheapestByService.values()]
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName))
      .map(offer => ({
        id: offer.serviceId,
        name: offer.serviceName,
        price: Math.ceil((offer.priceUsd * rate) / 10) * 10,
        country: offer.countryId,
        count: null,
      })));
  } catch (e: any) {
    req.log.warn({ country, err: e?.message ?? "unknown error" }, "SMSPool service listing failed");
    res.status(502).json({ error: "Could not load services right now. Please try again." });
  }
});

router.post("/sms/buy-number", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = BuySmsNumberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") }); return; }

  const { country, service } = parsed.data;
  let offer: Awaited<ReturnType<typeof getSmsPoolOffer>>;
  let rate: number;
  try {
    const [currentOffer, currentRate] = await Promise.all([
      getSmsPoolOffer(country, service),
      getSmsPoolNgnPerUsd(),
    ]);
    offer = currentOffer;
    rate = currentRate;
  } catch {
    res.status(502).json({ error: "Could not verify the service price right now. Please try again." }); return;
  }
  if (!offer) { res.status(400).json({ error: "Service or country not available right now" }); return; }
  const providerPrice = Math.ceil((offer.priceUsd * rate) / 10) * 10;
  // The SMSPool account is the funded provider wallet. Charge the user the
  // live displayed price only; do not require a second transfer from the
  // user's payout wallet and do not add a hidden fee at checkout.
  const price = providerPrice;

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, price, `SMS number for ${offer.serviceName} (${offer.countryName})`, "sms", {
      service,
      country,
      provider: "SMSPool",
      providerPriceUsd: offer.priceUsd,
      cipherPayProfit: 0,
      usdNgnRate: rate,
    }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  let purchasedOrderId: string | null = null;
  let purchasedNumber: string | null = null;
  try {
    // SMSPool is already funded on the provider side. Ordering directly from
    // that account avoids incorrectly requiring the user to fund a separate
    // Flutterwave payout/source wallet.
    const result = await orderSmsPoolNumber(offer);
    purchasedOrderId = result.orderId;
    purchasedNumber = result.number;
    const numberFormatted = result.number;
    const ref = result.orderId;
    const expiresAt = new Date(Date.now() + Math.max(60, result.expiresIn) * 1000);
    await db.transaction(async (database) => {
      await database.insert(smsActivationsTable).values({
        userId, activationId: ref, number: numberFormatted, service: offer!.serviceName, country: offer!.countryName,
        amount: price.toFixed(2), status: "pending", transactionId: tx.id,
      });
      await database.update(transactionsTable).set({
        metadata: JSON.stringify({
          provider: "SMSPool",
          service: offer!.serviceName,
          country: offer!.countryName,
          number: numberFormatted,
          reference: ref,
          providerCostUsd: result.costUsd,
          usdNgnRate: rate,
        }),
      }).where(eq(transactionsTable.id, tx.id));
    });

    res.json({
      activationId: ref,
      number: numberFormatted,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch (e: any) {
    if (purchasedOrderId) {
      let cancelled = false;
      try { cancelled = await cancelSmsPoolOrder(purchasedOrderId); } catch { /* continue with recovery response */ }
      if (!cancelled) {
        req.log.error({ txId: tx.id, orderId: purchasedOrderId, err: e?.message }, "SMSPool number purchased but activation persistence failed");
        res.status(502).json({
          error: "Your number was purchased, but its activation could not be saved. Contact support with this reference.",
          reference: purchasedOrderId,
          number: purchasedNumber,
        });
        return;
      }
    }
    await refundFailed(userId, tx.id, price, `Provider error: ${e.message ?? "unknown"}`, "sms");
    req.log.warn({ txId: tx.id, err: e?.message }, "SMS purchase failed after wallet debit");
    res.status(502).json({ error: smsPurchaseUserMessage(e) });
  }
});

router.get("/sms/check-sms/:activationId", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawId = Array.isArray(req.params.activationId) ? req.params.activationId[0] : req.params.activationId;
  const [activation] = await db.select().from(smsActivationsTable)
    .where(and(eq(smsActivationsTable.activationId, rawId), eq(smsActivationsTable.userId, userId)));
  if (!activation) { res.status(404).json({ error: "Activation not found" }); return; }

  try {
    const live = await checkSmsPoolOrder(rawId);
    if (live.status === "received" && live.code && !activation.code) {
      await db.update(smsActivationsTable).set({ code: live.code, status: "received" }).where(eq(smsActivationsTable.activationId, rawId));
      activation.code = live.code; activation.status = "received";
    } else if (live.status === "cancelled") {
      // The upstream number can expire on its own. Polling must not turn that
      // into a user cancellation or refund; the user must explicitly cancel
      // through POST /sms/cancel/:activationId.
      req.log.info({ activationId: rawId }, "SMS activation expired upstream; awaiting user cancellation");
    }
  } catch (e: any) {
    req.log.warn({ activationId: rawId, err: e?.message }, "SMSPool status check failed");
    res.status(502).json({ error: "Could not refresh this SMS activation. Please try again." });
    return;
  }

  res.json({
    activationId: rawId,
    status: activation.status,
    code: activation.code ?? null,
    fullSms: activation.code ? `Your verification code is ${activation.code}` : null,
  });
});

router.post("/sms/cancel/:activationId", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rawId = Array.isArray(req.params.activationId) ? req.params.activationId[0] : req.params.activationId;
  const [activation] = await db.select().from(smsActivationsTable)
    .where(and(eq(smsActivationsTable.activationId, rawId), eq(smsActivationsTable.userId, userId)));
  if (!activation) { res.status(404).json({ error: "Activation not found" }); return; }

  if (activation.status === "received" || activation.code) {
    res.status(400).json({ error: "This activation already received an SMS and cannot be refunded." });
    return;
  }
  if (activation.status === "cancelled") {
    const refunded = await refundSmsActivation(activation, "SMS number cancelled/expired without OTP");
    if (!refunded) {
      res.status(502).json({ error: "This number is cancelled, but its refund needs support review." });
      return;
    }
    res.json({ activationId: rawId, status: "cancelled", refunded: true, amount: parseFloat(activation.amount) });
    return;
  }
  if (activation.status !== "pending") {
    res.status(400).json({ error: "This activation cannot be cancelled." });
    return;
  }

  const eligibleAt = activation.createdAt.getTime() + SMS_CANCEL_AFTER_MS;
  if (Date.now() < eligibleAt) {
    const remainingSeconds = Math.ceil((eligibleAt - Date.now()) / 1000);
    res.status(400).json({
      error: `Refund becomes available after 15 minutes. Please wait ${Math.ceil(remainingSeconds / 60)} more minute${Math.ceil(remainingSeconds / 60) === 1 ? "" : "s"}.`,
      eligibleAt: new Date(eligibleAt).toISOString(),
    });
    return;
  }

  let live: Awaited<ReturnType<typeof checkSmsPoolOrder>>;
  try {
    live = await checkSmsPoolOrder(rawId);
  } catch (e: any) {
    req.log.warn({ activationId: rawId, err: e?.message }, "SMSPool cancellation status check failed");
    res.status(502).json({ error: "Could not verify the SMS status before cancelling. Please try again." });
    return;
  }

  if (live.status === "received") {
    await db.update(smsActivationsTable).set({ code: live.code ?? null, status: "received" })
      .where(eq(smsActivationsTable.activationId, rawId));
    res.status(400).json({ error: "The SMS has arrived, so this activation cannot be refunded." });
    return;
  }
  if (live.status === "unknown") {
    res.status(502).json({ error: "Could not confirm this activation is still pending. Please try again." });
    return;
  }

  if (live.status === "pending") {
    let cancelled = false;
    try {
      cancelled = await cancelSmsPoolOrder(rawId);
    } catch (e: any) {
      req.log.warn({ activationId: rawId, err: e?.message }, "SMSPool cancellation request failed");
      res.status(502).json({ error: "The provider could not cancel this number. Please try again." });
      return;
    }
    if (!cancelled) {
      res.status(409).json({ error: "The cancellation was not accepted. The number may have just expired or received an SMS." });
      return;
    }
  }

  const refunded = await refundSmsActivation(activation, "SMS number cancelled after 15 minutes without OTP");
  if (!refunded) {
    req.log.error({ activationId: rawId, transactionId: activation.transactionId }, "SMS activation cancelled but refund could not be confirmed");
    res.status(502).json({ error: "The number was cancelled, but the refund could not be confirmed. Please contact support." });
    return;
  }
  await db.update(smsActivationsTable).set({ status: "cancelled" })
    .where(and(eq(smsActivationsTable.activationId, rawId), eq(smsActivationsTable.status, "pending")));
  res.json({ activationId: rawId, status: "cancelled", refunded: true, amount: parseFloat(activation.amount) });
});

router.get("/sms/history", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const activations = await db.select().from(smsActivationsTable).where(and(
    eq(smsActivationsTable.userId, userId),
    notInArray(smsActivationsTable.status, ["cancelled"]),
  ));
  res.json(activations.map(a => ({
    activationId: a.activationId, number: a.number, service: a.service, country: a.country,
    amount: parseFloat(a.amount), status: a.status, code: a.code,
    createdAt: a.createdAt.toISOString(),
  })));
});

// ── Social boost 24-hour auto-refund ─────────────────────────────────────────
// Runs hourly. Any social order that has not reached completed/cancelled within
// 24 h gets one final live status check then is auto-refunded and cancelled.
async function runSocialBoostExpiry(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleOrders = await db.select().from(socialOrdersTable).where(
    and(
      notInArray(socialOrdersTable.status, ["completed", "partial", "cancelled", "failed"]),
      lt(socialOrdersTable.createdAt, cutoff),
    ),
  );

  for (const order of staleOrders) {
    // Re-check live status from socially.ng before refunding — it may have just completed.
    if (order.externalOrderId) {
      try {
        const live = await smmOrderStatus(order.externalOrderId);
        const liveKey = live.status?.toLowerCase();
        if (liveKey) {
          const mapped = liveKey === "completed" ? "completed"
            : liveKey === "partial" ? "partial"
            : liveKey === "cancelled" || liveKey === "canceled" ? "cancelled"
            : liveKey === "in progress" ? "processing"
            : liveKey;
          await db.update(socialOrdersTable).set({ status: mapped }).where(eq(socialOrdersTable.id, order.id));
          if (mapped === "completed") continue;
        }
      } catch {
        // Do not refund on an unavailable status endpoint. The next hourly
        // pass can retry with a live provider response.
        continue;
      }
    }

    // Refund via the linked debit transaction (idempotent CAS — safe to re-run).
    if (order.transactionId != null) {
      const amount = parseFloat(order.amount);
      const refunded = await refundFailed(
        order.userId, order.transactionId, amount,
        "Social boost not completed within 24 hours — auto-refunded", "social",
      );
      if (refunded) {
        await db.update(socialOrdersTable).set({ status: "cancelled" }).where(eq(socialOrdersTable.id, order.id));
      }
    } else {
      await db.update(socialOrdersTable).set({ status: "cancelled" }).where(eq(socialOrdersTable.id, order.id));
    }
  }
}

// Initial run 10 s after startup (lets DB pool settle), then every hour.
setTimeout(() => { runSocialBoostExpiry().catch(() => {}); }, 10_000);
setInterval(() => { runSocialBoostExpiry().catch(() => {}); }, 60 * 60 * 1000);

export default router;
