import { Router, type IRouter } from "express";
import { and, eq, lt, notInArray } from "drizzle-orm";
import { db, smsActivationsTable, socialOrdersTable, transactionsTable, usersTable } from "@workspace/db";
import {
  PlaceSocialOrderBody, BuySmsNumberBody,
} from "@workspace/api-zod";
import { creditWallet, debitWallet, formatTransaction } from "../lib/wallet";
import {
  flwReference,
} from "../lib/flutterwave";
import {
  listCountries as listSmsPoolCountries,
  listOffers as listSmsPoolOffers,
  getOffer as getSmsPoolOffer,
  getNgnPerUsd as getSmsPoolNgnPerUsd,
  orderNumber as orderSmsPoolNumber,
  checkOrder as checkSmsPoolOrder,
  cancelOrder as cancelSmsPoolOrder,
  esimCountries, esimPlans, esimPurchase, esimHistory, esimProfile, esimTopup,
  rentalStock, rentalPricing, rentalOrder, rentalActive, rentalMessages, rentalAutoExtend,
} from "../lib/smspool";
import {
  smmServices, smmFindService, smmAddOrder, smmOrderStatus,
  dataProviders as sociallyDataProviders, dataPackages as sociallyDataPackages, buyDataBundle as sociallyBuyDataBundle,
} from "../lib/socially";
import { logoPath } from "../lib/logos";
import { checkPerTxLimitSync, getUserKycLevel } from "../lib/kycLimits";
import { getServiceFeatureStatus, type ServiceFeatureKey } from "../lib/service-features";

const router: IRouter = Router();
// Service controls are enforced server-side as well as in the admin UI.
router.use(async (req, res, next) => {
  const path = req.path;
  let feature: ServiceFeatureKey | null = null;
  if (path.startsWith("/data")) feature = "data";
  else if (path.startsWith("/sms/esim")) feature = "sms_esim";
  else if (path.startsWith("/sms/rentals")) feature = "sms_rentals";
  else if (path.startsWith("/sms")) feature = "sms";
  else if (path.startsWith("/temporary-email")) feature = "temporary_email";
  else if (path === "/social-boost" || path.startsWith("/social-boost/")) feature = "social_boost";
  else if (path.startsWith("/email-pro") || path.startsWith("/email")) feature = "email_pro";
  if (!feature) return next();
  try {
    const status = await getServiceFeatureStatus();
    if (status[feature]) {
      next();
      return;
    }

    // Admin accounts bypass service toggles so the admin can still access,
    // test, and manage a service while it is disabled for normal users.
    const userId = getUserId(req);
    if (userId) {
      const [account] = await db.select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (account?.isAdmin) {
        next();
        return;
      }
    }

    res.status(503).json({ error: "This service is temporarily unavailable.", code: "SERVICE_DISABLED", feature });
    return;
  } catch (e) {
    next(e);
  }
});


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

// ── DATA BUNDLES — powered by Socially.ng ─────────────────────────────────
// Flutterwave is intentionally NOT used for airtime, data or bills anymore.
// Data catalog + delivery come directly from the Socially provider account.

const DATA_TTL_MS = 10 * 60 * 1000;
let sociallyDataProviderCache: { at: number; providers: Awaited<ReturnType<typeof sociallyDataProviders>> } | null = null;
const sociallyDataPackageCache = new Map<string, { at: number; packages: Awaited<ReturnType<typeof sociallyDataPackages>> }>();

async function getSociallyDataProviders(force = false) {
  if (!force && sociallyDataProviderCache && Date.now() - sociallyDataProviderCache.at < DATA_TTL_MS) return sociallyDataProviderCache.providers;
  const providers = await sociallyDataProviders();
  if (providers.length) sociallyDataProviderCache = { at: Date.now(), providers };
  return providers;
}

async function getSociallyDataPackages(providerCode: string) {
  const cached = sociallyDataPackageCache.get(providerCode);
  if (cached && Date.now() - cached.at < DATA_TTL_MS) return cached.packages;
  const packages = await sociallyDataPackages(providerCode);
  if (packages.length) sociallyDataPackageCache.set(providerCode, { at: Date.now(), packages });
  return packages;
}

router.get("/data/providers", async (_req, res): Promise<void> => {
  try {
    res.json(await getSociallyDataProviders());
  } catch (e: any) {
    res.status(502).json({ error: "Data providers are temporarily unavailable.", details: e?.message });
  }
});

router.get("/data/plans", async (req, res): Promise<void> => {
  try {
    const requested = String(req.query.provider ?? req.query.network ?? "").trim();
    const providers = await getSociallyDataProviders();
    const selected = requested
      ? providers.find((p) => p.provider_code.toLowerCase() === requested.toLowerCase() || p.provider_name.toLowerCase() === requested.toLowerCase())
      : null;
    const targets = selected ? [selected] : providers;
    const groups = await Promise.all(targets.map(async (provider) => ({
      provider: provider.provider_code,
      providerName: provider.provider_name,
      packages: await getSociallyDataPackages(provider.provider_code),
    })));
    res.json(groups.flatMap((group) => group.packages.map((pkg) => ({
      id: pkg.package_code,
      name: pkg.package_name,
      size: pkg.package_name.match(/\\d+(?:\\.\\d+)?\\s*(?:MB|GB|TB)/i)?.[0] ?? pkg.package_name,
      validity: pkg.package_name.match(/\\d+\\s*(?:day|days|week|weeks|month|months)/i)?.[0] ?? "",
      price: pkg.amount,
      provider: group.provider,
      providerName: group.providerName,
      packageCode: pkg.package_code,
    }))));
  } catch (e: any) {
    res.status(502).json({ error: "Data plans are temporarily unavailable.", details: e?.message });
  }
});

router.post("/data/buy", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const providerCode = String(req.body?.provider ?? req.body?.network ?? "").trim();
  const packageCode = String(req.body?.packageCode ?? req.body?.planId ?? "").trim();
  const phone = normalizeNgPhone(String(req.body?.phone ?? ""));
  if (!providerCode || !packageCode || !phone) { res.status(400).json({ error: "Choose a provider, data bundle and valid phone number." }); return; }

  let pkg: any;
  try {
    const packages = await getSociallyDataPackages(providerCode);
    pkg = packages.find((item) => item.package_code === packageCode);
  } catch (e: any) {
    res.status(502).json({ error: "Data plans are temporarily unavailable.", details: e?.message });
    return;
  }
  if (!pkg) { res.status(400).json({ error: "Data bundle not found or no longer available." }); return; }

  const amount = Number(pkg.amount);
  const limitError = checkPerTxLimitSync(await getUserKycLevel(userId), amount);
  if (limitError) { res.status(400).json({ error: limitError }); return; }

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, amount, `${pkg.package_name} data for ${phone}`, "data", { provider: providerCode, phone, packageCode, package: pkg }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  try {
    const reference = flwReference(`DATA${tx.id}`);
    const result = await sociallyBuyDataBundle({ providerCode, recipient: phone, packageCode, reference });
    if (!result.ok) {
      await refundFailed(userId, tx.id, amount, `Data delivery failed: ${result.message || "provider declined"}`, "data");
      res.status(502).json({ error: "Data delivery failed. You have been refunded.", details: result.message });
      return;
    }
    await safePersist(req, tx.id, async () => {
      await db.update(transactionsTable).set({
        status: /pending|process/i.test(String(result.status ?? "")) ? "pending" : "success",
        metadata: JSON.stringify({ provider: providerCode, phone, packageCode, providerReference: result.reference, providerStatus: result.status }),
      }).where(eq(transactionsTable.id, tx.id));
    });
    res.json({ success: true, processing: /pending|process/i.test(String(result.status ?? "")), message: result.message || "Data bundle ordered successfully.", reference, transaction: formatTransaction({ ...tx, status: /pending|process/i.test(String(result.status ?? "")) ? "pending" : "success" }) });
  } catch (e: any) {
    await refundFailed(userId, tx.id, amount, `Provider error: ${e?.message ?? "unknown"}`, "data");
    res.status(502).json({ error: "Data provider error. You have been refunded.", details: e?.message });
  }
});

// Bills are intentionally disabled until a non-Flutterwave provider is connected.
router.get("/bills/categories", (_req, res) => { res.status(410).json({ error: "Bill payments are temporarily unavailable." }); });
router.get("/bills/providers", (_req, res) => { res.status(410).json({ error: "Bill payments are temporarily unavailable." }); });
router.post("/bills/validate", (_req, res) => { res.status(410).json({ error: "Bill payments are temporarily unavailable." }); });
router.post("/bills/pay", (_req, res) => { res.status(410).json({ error: "Bill payments are temporarily unavailable." }); });

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

router.get("/social/services", async (req, res): Promise<void> => {
  const { category, platform } = req.query as { category?: string; platform?: string };
  try {
    const live = await smmServices();
    const services = SOCIAL_SERVICES
      .filter((service) => !category || service.category === category)
      .filter((service) => !platform || service.platform === platform)
      .map((service) => {
        const provider = live
          .filter((item) => {
            const hay = `${item.name} ${item.category}`.toLowerCase();
            const anchor = service.keywords[0]?.toLowerCase();
            if (anchor && !hay.includes(anchor)) return false;
            return service.keywords.some((k) => hay.includes(k.toLowerCase()));
          })
          .sort((a, b) => {
            const score = (item: typeof a) => service.keywords.filter((k) => `${item.name} ${item.category}`.toLowerCase().includes(k.toLowerCase())).length;
            const diff = score(b) - score(a);
            if (diff) return diff;
            const ar = service.minQuantity >= a.min && service.minQuantity <= a.max ? 1 : 0;
            const br = service.minQuantity >= b.min && service.minQuantity <= b.max ? 1 : 0;
            return br - ar || a.rate - b.rate;
          })[0];
        if (!provider) return null;
        const claims = [
          provider.refill ? (provider.refillDays ? `${provider.refillDays}-day refill` : "Refill available") : "No refill flag",
          provider.cancel ? "Cancellation supported" : "Cancellation unavailable",
          provider.dripfeed ? "Drip-feed supported" : "Standard delivery",
          /non[ -]?drop/i.test(provider.name) ? "Provider advertises non-drop" : "",
        ].filter(Boolean);
        return {
          ...(({ keywords: _k, ...rest }) => rest)(service),
          pricePerUnit: provider.rate / 1000,
          providerRate: provider.rate,
          platformFee: 200,
          minQuantity: Math.max(service.minQuantity, provider.min),
          maxQuantity: Math.min(service.maxQuantity, provider.max),
          refill: Boolean(provider.refill),
          cancel: Boolean(provider.cancel),
          dripfeed: Boolean(provider.dripfeed),
          refillDays: provider.refillDays,
          providerClaims: claims,
          providerServiceId: provider.service,
          providerServiceName: provider.name,
          providerCategory: provider.category,
        };
      })
      .filter(Boolean);
    res.json(services);
  } catch (e: any) {
    res.status(502).json({ error: "Live Social Boost services are temporarily unavailable.", details: e?.message });
  }
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

  const sociallyService = await smmFindService(service.keywords, quantity);
  if (!sociallyService) { res.status(502).json({ error: "No live provider service is available for this order right now." }); return; }
  const providerAmount = (sociallyService.rate * quantity) / 1000;
  const amount = Math.ceil((providerAmount + 200) / 10) * 10;

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, amount, `${service.name} x${quantity} - ${link}`, "social", { serviceId, link, quantity, providerAmount, cipherPayProfit: 200 }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  try {
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
    await refundFailed(userId, tx.id, amount, `Provider error: ${e.message ?? "unknown"}`, "social");
    res.status(502).json({ error: "Provider error. You have been refunded.", details: e.message });
  }
});


router.post("/social/mass-order", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!raw.length || raw.length > 50) { res.status(400).json({ error: "Provide between 1 and 50 orders." }); return; }

  const orders = raw.map((item: any) => ({
    serviceId: String(item?.serviceId ?? ""),
    link: String(item?.link ?? "").trim(),
    quantity: Math.trunc(Number(item?.quantity ?? 0)),
  })).filter((item: any) => item.serviceId && item.link && item.quantity > 0);

  if (orders.length !== raw.length) { res.status(400).json({ error: "Each order needs a service, link and positive quantity." }); return; }

  const prepared: any[] = [];
  let total = 0;
  for (const item of orders) {
    const service = SOCIAL_SERVICES.find((s) => s.id === item.serviceId);
    if (!service) { res.status(400).json({ error: `Service not found: ${item.serviceId}` }); return; }
    if (item.quantity < service.minQuantity || item.quantity > service.maxQuantity) {
      res.status(400).json({ error: `${service.name}: quantity must be between ${service.minQuantity} and ${service.maxQuantity}` }); return;
    }
    const provider = await smmFindService(service.keywords, item.quantity);
    if (!provider) { res.status(400).json({ error: `No live provider service is available for ${service.name} right now.` }); return; }
    const providerAmount = provider.rate * item.quantity / 1000;
    const amount = Math.ceil((providerAmount + 200) / 10) * 10;
    total += amount;
    prepared.push({ item, service, provider, providerAmount, amount });
  }

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, total, `Socially mass order (${prepared.length} orders)`, "social", { massOrder: true, total, count: prepared.length }));
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  const results: any[] = [];
  let deliveredCount = 0;
  for (const entry of prepared) {
    try {
      const result = await smmAddOrder({ service: entry.provider.service, link: entry.item.link, quantity: entry.item.quantity });
      if (!result.ok || !result.orderId) throw new Error(result.error ?? "Provider rejected the order");
      deliveredCount++;
      results.push({ serviceId: entry.item.serviceId, link: entry.item.link, quantity: entry.item.quantity, amount: entry.amount, externalOrderId: result.orderId, status: "processing" });
    } catch (e: any) {
      results.push({ serviceId: entry.item.serviceId, link: entry.item.link, quantity: entry.item.quantity, amount: entry.amount, status: "failed", error: e?.message ?? "Provider rejected the order" });
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  const refundAmount = failed.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (refundAmount > 0) {
    await creditWallet(userId, refundAmount, "Refund: failed Socially mass-order items", "refund", { massOrder: true, failed: failed.length });
  }
  await db.update(transactionsTable).set({ status: failed.length === results.length ? "failed" : "success", metadata: JSON.stringify({ massOrder: true, results }) }).where(eq(transactionsTable.id, tx.id));

  res.json({ success: failed.length === 0, total, deliveredCount, failedCount: failed.length, refundAmount, results });
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
  const activationType = String(req.body?.activationType ?? "SMS").toUpperCase();
  if (!["SMS", "VOICE", "FLASH"].includes(activationType)) { res.status(400).json({ error: "Invalid activation type." }); return; }
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
  // CipherPay adds a fixed ₦400 profit to every SMS verification purchase.
  // The provider account is already funded, so do not move money through the
  // user's separate payout/source wallet before ordering.
  const cipherPayProfit = 400;
  const price = providerPrice + cipherPayProfit;

  let tx: any;
  try {
    ({ tx } = await debitWallet(userId, price, `SMS number for ${offer.serviceName} (${offer.countryName})`, "sms", {
      service,
      country,
      provider: "SMSPool",
      providerPriceUsd: offer.priceUsd,
      cipherPayProfit,
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
    const result = await orderSmsPoolNumber(offer, activationType as "SMS" | "VOICE" | "FLASH");
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
          activationType,
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


// ── SMSPool advanced catalog ────────────────────────────────────────────────
router.get("/sms/esim/countries", async (_req, res) => {
  try { res.json(await esimCountries()); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "eSIM countries unavailable" }); }
});

router.get("/sms/esim/plans", async (req, res) => {
  const country = String(req.query.country ?? "");
  if (!country) { res.status(400).json({ error: "Country is required." }); return; }
  try { res.json(await esimPlans(country)); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "eSIM plans unavailable" }); }
});


router.post("/sms/esim/buy", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const country = String(req.body?.country ?? "");
  const plan = String(req.body?.plan ?? "");
  if (!country || !plan) { res.status(400).json({ error: "Choose an eSIM country and plan." }); return; }
  try {
    const plans = await esimPlans(country);
    const selected: any = plans.find((item: any) => String(item.id ?? item.plan_id ?? item.plan ?? "") === plan);
    const providerPrice = Number(selected?.price ?? selected?.cost ?? selected?.amount ?? 0);
    if (!(providerPrice > 0)) { res.status(400).json({ error: "That eSIM plan is no longer available." }); return; }
    const amount = Math.ceil(providerPrice * 1.15 / 10) * 10;
    const { tx } = await debitWallet(userId, amount, "SMSPool international data eSIM", "service", { provider: "SMSPool", country, plan, providerPrice });
    try {
      const result = await esimPurchase(plan);
      if (result?.success === 0 || result?.success === false) throw new Error(String(result?.message ?? result?.error ?? "eSIM purchase failed"));
      await db.update(transactionsTable).set({ status: "success", metadata: JSON.stringify({ provider: "SMSPool", product: "eSIM", country, plan, providerPrice, response: result }) }).where(eq(transactionsTable.id, tx.id));
      res.json({ success: true, amount, result });
    } catch (e: any) {
      await creditWallet(userId, amount, "Refund: eSIM purchase failed", "refund", { originalTxId: tx.id, provider: "SMSPool" });
      await db.update(transactionsTable).set({ status: "failed" }).where(eq(transactionsTable.id, tx.id));
      res.status(502).json({ error: e?.message ?? "eSIM purchase failed. Your wallet was refunded." });
    }
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Could not purchase eSIM." });
  }
});

router.get("/sms/esim/history", async (_req, res) => {
  try { res.json(await esimHistory()); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "eSIM history unavailable" }); }
});

router.get("/sms/esim/profile", async (req, res) => {
  const esim = String(req.query.esim ?? "");
  if (!esim) { res.status(400).json({ error: "eSIM identifier is required." }); return; }
  try { res.json(await esimProfile(esim)); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "eSIM profile unavailable" }); }
});

router.get("/sms/rentals/pricing", async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!id) { res.status(400).json({ error: "Rental option is required." }); return; }
  try {
    const raw = await rentalPricing(id);
    const pricing = raw?.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
    const rate = await getSmsPoolNgnPerUsd();
    const options = Object.entries(pricing)
      .map(([days, value]) => {
        const usd = Number(value);
        if (!Number.isFinite(usd) || usd <= 0) return null;
        const amount = Math.ceil((usd * rate * 1.15) / 10) * 10;
        return { days: Number(days), amount, providerPriceUsd: usd };
      })
      .filter((item): item is { days: number; amount: number; providerPriceUsd: number } => !!item && Number.isFinite(item.days) && item.days > 0)
      .sort((a, b) => a.days - b.days);
    res.json({ options });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? "Rental pricing unavailable" });
  }
});

router.post("/sms/rentals/buy", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = String(req.body?.id ?? "");
  const days = Number(req.body?.days ?? 0);
  if (!id || !Number.isInteger(days) || days <= 0) {
    res.status(400).json({ error: "Choose a rental and duration." });
    return;
  }

  try {
    const raw = await rentalPricing(id);
    const pricing = raw?.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
    const providerPriceUsd = Number(pricing[String(days)]);
    if (!(providerPriceUsd > 0)) {
      res.status(400).json({ error: "That rental duration is no longer available." });
      return;
    }

    const rate = await getSmsPoolNgnPerUsd();
    const amount = Math.ceil((providerPriceUsd * rate * 1.15) / 10) * 10;
    const { tx } = await debitWallet(
      userId,
      amount,
      "Long-term number rental",
      "service",
      { product: "long_term_number", rentalId: id, days, providerPriceUsd },
    );

    try {
      const result = await rentalOrder(id, days);
      if (result?.success === 0 || result?.success === false) {
        throw new Error(String(result?.message ?? result?.error ?? "Rental purchase failed"));
      }
      await db.update(transactionsTable)
        .set({ status: "success", metadata: JSON.stringify({ product: "long_term_number", rentalId: id, days, providerPriceUsd, response: result }) })
        .where(eq(transactionsTable.id, tx.id));
      res.json({ success: true, amount, days, result });
    } catch (e: any) {
      await creditWallet(userId, amount, "Refund: long-term number purchase failed", "refund", { originalTxId: tx.id, product: "long_term_number" });
      await db.update(transactionsTable).set({ status: "failed" }).where(eq(transactionsTable.id, tx.id));
      res.status(502).json({ error: e?.message ?? "Rental purchase failed. Your wallet was refunded." });
    }
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Could not purchase long-term number." });
  }
});

router.get("/sms/rentals/stock", async (_req, res) => {
  try { res.json(await rentalStock()); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "Rental stock unavailable" }); }
});

router.get("/sms/rentals/active", async (_req, res) => {
  try { res.json(await rentalActive()); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "Active rentals unavailable" }); }
});

router.get("/sms/rentals/messages", async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!code) { res.status(400).json({ error: "Rental code is required." }); return; }
  try { res.json(await rentalMessages(code)); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "Rental messages unavailable" }); }
});

router.post("/sms/rentals/auto-extend", async (req, res) => {
  const code = String(req.body?.code ?? "");
  if (!code) { res.status(400).json({ error: "Rental code is required." }); return; }
  try { res.json(await rentalAutoExtend(code)); }
  catch (e: any) { res.status(502).json({ error: e?.message ?? "Could not update auto-extension" }); }
});

export default router;
