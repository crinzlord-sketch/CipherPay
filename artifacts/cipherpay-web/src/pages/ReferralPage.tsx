import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Gift, Link2, Share2, UsersRound, WalletCards } from "lucide-react";
import { apiRequest } from "./page-api";
import "./cipherpay-pages.css";

type ReferralData = {
  referralCode: string;
  referralLink: string;
  rewardPerReferral: number;
  friendReward: number;
  totalEarned: number;
  successful: number;
  pending: number;
  referrals: Array<{ id: number; name: string; status: "rewarded" | "pending"; createdAt: string }>;
};

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default function ReferralPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<ReferralData>("/api/referrals")
      .then((result) => { if (active) setData(result); })
      .catch((reason: any) => { if (active) setError(reason?.message ?? "We could not load your referral details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const copy = async (value: string, kind: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Could not copy that. Please select it manually.");
    }
  };

  const share = async () => {
    if (!data) return;
    const text = `Join me on CipherPay. Use my code ${data.referralCode} and get ${money.format(data.friendReward)} when you verify your account.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Join me on CipherPay", text, url: "https://cipherpay.it.com/register?ref=" + data.referralCode });
      } else {
        await navigator.clipboard.writeText(`${text} ${data.referralLink}`);
      }
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // The user cancelled the native share sheet.
    }
  };

  if (loading) {
    return <div className="referral-page"><div className="referral-loading"><span className="referral-spinner" /> Loading your referral hub…</div></div>;
  }

  if (error || !data) {
    return <div className="referral-page"><section className="referral-error"><Gift size={22} /><h2>Referral hub unavailable</h2><p>{error || "We could not load your referral details."}</p></section></div>;
  }

  return <div className="referral-page">
    <div className="referral-orb referral-orb-one" />
    <div className="referral-orb referral-orb-two" />

    <div className="referral-heading">
      <div>
        <span className="eyebrow">GROW / REFERRALS</span>
        <h1>Bring your people.<br /><em>Get rewarded.</em></h1>
        <p>Share CipherPay with someone you trust. They get a welcome reward, and you earn when they verify their account.</p>
      </div>
      <button className="btn btn-primary referral-share-btn" type="button" onClick={() => void share()}>
        {shared ? <Check size={17} /> : <Share2 size={17} />}
        {shared ? "Shared" : "Share invite"}
      </button>
    </div>

    <section className="referral-hero-card">
      <div className="referral-hero-glow" />
      <div className="referral-hero-copy">
        <span className="referral-chip"><Gift size={14} /> YOUR REFERRAL CODE</span>
        <div className="referral-code-row">
          <strong>{data.referralCode}</strong>
          <button type="button" onClick={() => void copy(data.referralCode, "code")} aria-label="Copy referral code">
            {copied === "code" ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <p>Give them this code at signup, or send the invite link and we’ll fill it in for them.</p>
        <div className="referral-link-row">
          <Link2 size={16} />
          <span>{"https://cipherpay.it.com/register?ref=" + data.referralCode}</span>
          <button type="button" onClick={() => void copy("https://cipherpay.it.com/register?ref=" + data.referralCode, "link")} aria-label="Copy referral link">
            {copied === "link" ? <Check size={17} /> : <Copy size={17} />}
          </button>
        </div>
      </div>
      <div className="referral-hero-badge">
        <span><WalletCards size={18} /></span>
        <b>{money.format(data.rewardPerReferral)}</b>
        <small>per verified referral</small>
      </div>
    </section>

    <div className="referral-stats">
      <article><span className="referral-stat-icon"><WalletCards size={18} /></span><div><b>{money.format(data.totalEarned)}</b><small>Total earned</small></div></article>
      <article><span className="referral-stat-icon"><UsersRound size={18} /></span><div><b>{data.successful}</b><small>Successful referrals</small></div></article>
      <article><span className="referral-stat-icon"><Gift size={18} /></span><div><b>{data.pending}</b><small>Pending verification</small></div></article>
    </div>

    <div className="referral-content-grid">
      <section className="panel referral-steps">
        <div className="referral-section-head"><div><span className="section-kicker">HOW IT WORKS</span><h2>Three easy moves.</h2></div><span className="referral-rule">No complicated links required.</span></div>
        <div className="referral-step-list">
          <div><span>01</span><div><b>Share your code</b><p>Send your code or invite link to a friend.</p></div></div>
          <div><span>02</span><div><b>They sign up</b><p>They enter your code during registration and verify their email.</p></div></div>
          <div><span>03</span><div><b>You both get rewarded</b><p>You receive {money.format(data.rewardPerReferral)} and they receive {money.format(data.friendReward)}.</p></div></div>
        </div>
      </section>

      <section className="panel referral-history">
        <div className="referral-section-head"><div><span className="section-kicker">REFERRAL ACTIVITY</span><h2>Your people.</h2></div><span className="referral-count">{data.referrals.length}</span></div>
        {data.referrals.length === 0 ? <div className="referral-empty"><UsersRound size={22} /><b>No referrals yet.</b><p>Copy your code and send it to someone you know.</p></div> : <div className="referral-list">
          {data.referrals.map((person) => <div className="referral-person" key={person.id}>
            <span className="referral-avatar">{person.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
            <div><b>{person.name}</b><small>{formatDate(person.createdAt)}</small></div>
            <span className={`referral-status ${person.status}`}>{person.status === "rewarded" ? <><Check size={13} /> Rewarded</> : "Pending"}</span>
          </div>)}
        </div>}
      </section>
    </div>
  </div>;
}
