// Lightweight rule-based support bot. Pattern-matches the user's question
// against known CipherPay intents and returns a canned answer plus an
// "escalate" hint when the bot has low confidence and should suggest the
// user talk to a live agent.

export interface BotReply {
  body: string;
  confident: boolean;
}

interface Intent {
  id: string;
  // keywords are matched as whole-ish words (case-insensitive). A match on
  // ANY keyword in the array counts; multiple intents may match — highest
  // score (most distinct keyword hits) wins.
  keywords: string[];
  answer: string;
}

const INTENTS: Intent[] = [
  {
    id: "greeting",
    keywords: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "howdy"],
    answer: "Hi there 👋 I'm the CipherPay support assistant. I can help with wallet funding, transfers, KYC, airtime/data, bill payments, social boost, and SMS verification. What's on your mind?",
  },
  {
    id: "thanks",
    keywords: ["thank", "thanks", "thx", "appreciate"],
    answer: "You're welcome! Let me know if anything else comes up.",
  },
  {
    id: "bye",
    keywords: ["bye", "goodbye", "see you", "later"],
    answer: "Take care! Reach out anytime — we're here 24/7.",
  },
  {
    id: "fund-wallet",
    keywords: ["fund", "deposit", "top up wallet", "add money", "load wallet", "flutterwave"],
    answer: "To fund your wallet: open Wallet → tap Fund → enter the amount → pay securely with card or bank transfer in the app. Funds arrive instantly once the payment is confirmed.",
  },
  {
    id: "withdraw",
    keywords: ["withdraw", "withdrawal", "cash out", "send to bank", "bank transfer", "payout"],
    answer: "To send to a bank: Wallet → Send → choose 'Bank account' → pick the bank and enter the account number (we confirm the name) → enter the amount → confirm. A small tiered fee applies. Funds usually land in the bank account within minutes.",
  },
  {
    id: "withdraw-otp",
    keywords: ["otp", "code not arriving", "didn't get code", "no code", "verification code"],
    answer: "OTPs are emailed instantly and expire after 10 minutes. Check your spam folder. If it still hasn't arrived, tap 'Resend code' on the OTP screen and double-check the email on your profile is correct.",
  },
  {
    id: "transfer",
    keywords: ["transfer", "send to friend", "send money", "p2p", "send to another user"],
    answer: "To transfer to another CipherPay user: Wallet → Transfer → enter their email or @username → amount → confirm. Transfers between CipherPay accounts are instant and free.",
  },
  {
    id: "kyc",
    keywords: ["kyc", "verify", "verification", "bvn", "nin", "id upload", "selfie", "passport", "driver", "licence", "license"],
    answer: "To get verified: open KYC → pick your ID type (BVN, NIN, Passport, Driver's Licence, National ID, or Voter's Card) → enter details → take photos of the document and a selfie holding it. Our team reviews submissions within 24 hours. Level 1 unlocks ₦200,000/day, Level 2 unlocks ₦1,000,000/day.",
  },
  {
    id: "kyc-rejected",
    keywords: ["kyc rejected", "verification failed", "rejected", "denied", "resubmit"],
    answer: "If your KYC was rejected, the rejection reason is shown at the top of the KYC screen. You can resubmit any time — just tap KYC → Resubmit and follow the steps again with clearer photos.",
  },
  {
    id: "airtime",
    keywords: ["airtime", "recharge", "credit my phone", "buy airtime"],
    answer: "Airtime: Services → Airtime → pick your network (MTN, Glo, Airtel, 9Mobile) → enter the phone number and amount. Delivery is usually instant. If a purchase fails, your wallet is refunded automatically.",
  },
  {
    id: "data",
    keywords: ["data bundle", "data plan", "internet", "buy data", "mb", "gb"],
    answer: "Data: Services → Data → choose network → pick a plan (1GB, 2GB, etc.) → enter the phone number. Delivery is instant for most networks.",
  },
  {
    id: "bills",
    keywords: ["bill", "electricity", "ekedc", "ikedc", "phed", "dstv", "gotv", "startimes", "cable", "tv subscription", "water", "betting"],
    answer: "Bill payments: Services → Bill Payments → pick the category (Electricity, Cable TV, Internet, Water, Betting) → choose the provider → enter your customer ID (we'll verify the name for you) → amount → pay.",
  },
  {
    id: "social",
    keywords: ["social", "followers", "likes", "views", "instagram", "tiktok", "youtube", "twitter", "facebook", "boost"],
    answer: "Social Boost: Services → Social Boost → pick a platform (Instagram, TikTok, YouTube, Twitter, Facebook) → choose followers/likes/views/comments → enter the link and quantity. Delivery time varies by provider (instant to 72 hours).",
  },
  {
    id: "sms",
    keywords: ["sms", "virtual number", "phone number", "whatsapp verification", "telegram verification", "otp number"],
    answer: "SMS Verification: Services → SMS → pick the service you want to verify (WhatsApp, Telegram, Instagram, etc.) and country. We give you a virtual number; codes appear on the activation screen within seconds. Numbers are valid for 20 minutes.",
  },
  {
    id: "transaction-failed",
    keywords: ["failed", "didn't get", "didn't receive", "not delivered", "pending forever", "stuck"],
    answer: "If a service didn't deliver, the charge is refunded to your wallet automatically — usually within minutes, sometimes up to 30 minutes for provider checks. Check Transactions → look for a 'refunded' entry. If 30 minutes have passed and there's no refund, tap 'Talk to a live agent' below with your transaction reference and we'll investigate.",
  },
  {
    id: "refund",
    keywords: ["refund", "money back", "charge back", "chargeback"],
    answer: "Refunds happen automatically when a service fails. They land back in your wallet, not your bank — usually within minutes. For Paystack-funded amounts that haven't been used, refunds to your bank take 3–5 business days.",
  },
  {
    id: "balance",
    keywords: ["balance", "how much do i have", "wallet balance", "check balance"],
    answer: "Your wallet balance is shown at the top of the Wallet screen. Pull down to refresh if it looks stale.",
  },
  {
    id: "password",
    keywords: ["password", "forgot password", "reset password", "can't login", "cant login", "locked out"],
    answer: "Forgot your password? On the login screen, tap 'Forgot password' → enter your email → we'll send a reset link. If your account is locked due to too many failed attempts, wait 15 minutes and try again, or talk to a live agent.",
  },
  {
    id: "delete-account",
    keywords: ["delete account", "close account", "deactivate"],
    answer: "Account deletion requires a live agent for verification. Tap 'Talk to a live agent' below and we'll guide you through it. Note: any wallet balance must be withdrawn first.",
  },
  {
    id: "contact",
    keywords: ["email support", "support email", "contact email", "phone number support", "reach support"],
    answer: "You can use this support chat to reach us directly, or tap “Talk to a live agent” when you want a person.",
  },
  {
    id: "limits",
    keywords: ["limit", "daily limit", "maximum", "max amount", "how much can i send"],
    answer: "Daily transaction limits depend on KYC level:\n• Level 0 (unverified): ₦50,000/day\n• Level 1 (BVN/NIN): ₦200,000/day\n• Level 2 (full KYC): ₦1,000,000/day\nUpgrade in the KYC section to raise your limit.",
  },
  {
    id: "fees",
    keywords: ["fee", "fees", "charges", "how much does", "cost"],
    answer: "Most CipherPay services are free or transparent flat fees:\n• P2P transfers: FREE\n• Bank withdrawals: ₦50 flat\n• Airtime/Data/Bills: provider price, no markup\n• Social boost & SMS: shown on the order screen before you pay",
  },
  {
    id: "referral",
    keywords: ["referral", "refer", "invite friend", "referral code", "bonus"],
    answer: "Find your referral code on the Profile screen. Share it with friends — when they sign up and complete their first transaction, you both earn a bonus to your wallet.",
  },
  {
    id: "human",
    keywords: ["human", "live agent", "real person", "agent", "speak to someone", "talk to someone", "talk to a person", "representative"],
    answer: "No problem — tap the 'Talk to a live agent' button below and someone from our team will join this chat shortly.",
  },
];

// Strip punctuation and lowercase
function normalize(s: string): string {
  return " " + s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ") + " ";
}

export function getBotReply(message: string): BotReply {
  const text = normalize(message);
  let best: { intent: Intent; score: number } | null = null;
  for (const intent of INTENTS) {
    let score = 0;
    for (const kw of intent.keywords) {
      // Whole-word-ish match: surround keyword with spaces
      const needle = " " + kw.toLowerCase() + " ";
      if (text.includes(needle)) score += 2;
      else if (text.includes(kw.toLowerCase())) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { intent, score };
  }
  if (best && best.score >= 2) {
    return { body: best.intent.answer, confident: true };
  }
  if (best) {
    return {
      body:
        best.intent.answer +
        "\n\n_Was this what you meant? If not, tap 'Talk to a live agent' and our team will jump in._",
      confident: false,
    };
  }
  return {
    body: "Tell me a little more about what happened and I’ll help you work through it. Tell me what you were trying to do, what you saw on screen, or any transaction reference. If you prefer a person, tap 'Talk to a live agent'.",
    confident: false,
  };
}

export const WELCOME_MESSAGE =
  "👋 Welcome to CipherPay Support! I'm the support assistant — I can answer questions about wallet funding, transfers, KYC, airtime, bills, social boost, SMS verification, and more.\n\nAsk me anything in your own words — I’ll help you work through it. If you need a person, tap **Talk to a live agent** anytime.";
