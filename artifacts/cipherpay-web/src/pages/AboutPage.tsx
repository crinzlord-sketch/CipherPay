import { ArrowLeft, ArrowRight, Banknote, Bitcoin, Check, Globe2, LockKeyhole, MessageSquare, Send, ShieldCheck, Smartphone, ShoppingBag, Sparkles, WalletCards, Wifi, Mail, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import './about.css';

const featureGroups = [
  { label: 'MONEY', title: 'A wallet built for everyday movement.', items: [
    ['Wallet funding', 'Fund your CipherPay wallet and keep your wallet activity in one clear place.', WalletCards],
    ['Send money', 'Move money to other CipherPay users through a focused transfer flow.', Send],
    ['Bills & payments', 'Pay supported everyday bills and services directly from your wallet.', Banknote],
    ['Referrals', 'Invite others and earn through the CipherPay referral experience.', UsersRound],
  ]},
  { label: 'DIGITAL SERVICES', title: 'The tools you normally need scattered across different apps.', items: [
    ['SMS verification', 'Access SMS verification services across supported countries and platforms.', MessageSquare],
    ['International eSIM', 'Explore international eSIM options from one CipherPay account.', Globe2],
    ['Long-term numbers', 'Get longer-term phone number options for supported use cases.', Smartphone],
    ['Temporary email', 'Create temporary email addresses when you need a quick, disposable inbox.', Mail],
    ['Email Pro', 'Use CipherPay email tools from the same account.', Mail],
    ['Data bundles', 'Purchase supported mobile data bundles from your wallet.', Wifi],
  ]},
  { label: 'SOCIAL', title: 'Social tools with buying and growth services in one place.', items: [
    ['Social Boost', 'Purchase supported social growth services and track your orders.', Sparkles],
    ['Social Accounts', 'Browse available social media account inventory by platform and country.', ShoppingBag],
    ['Seller marketplace', 'Approved sellers can list social account inventory and manage withdrawals.', UsersRound],
    ['Find & chat', 'Find other CipherPay users by CipherPay code and chat with text, images, GIFs and replies.', MessageSquare],
  ]},
  { label: 'CRYPTO', title: 'A multi-asset direction built into the platform.', items: [
    ['Crypto wallet', 'CipherPay is being built to support digital assets alongside everyday money.', Bitcoin],
    ['Send, receive & swap', 'The crypto experience is designed around simple asset movement and management.', ArrowRight],
  ]},
];

export default function AboutPage() {
  return <main className="about-page">
    <header className="about-nav">
      <Link href="/" className="about-back"><ArrowLeft size={16} /> Back to CipherPay</Link>
      <Link href="/" className="about-brand">Cipher<span>Pay</span></Link>
      <Link href="/register" className="about-cta">Create account <ArrowRight size={15} /></Link>
    </header>

    <section className="about-hero">
      <div className="about-hero-copy"><span className="about-kicker"><i /> CIPHERPAY / ABOUT</span><h1>One platform for the way <em>life moves.</em></h1><p>CipherPay brings money, digital services, communication and commerce into one account — designed to feel simple even when the work behind it is not.</p></div>
      <div className="about-hero-panel"><span>WHAT CIPHERPAY IS</span><strong>Wallet. Payments. Digital services. Social tools.</strong><small>One place to access the tools you use every day, without constantly moving between different platforms.</small></div>
    </section>

    <section className="about-intro about-width"><div><span className="about-section-label">THE IDEA</span><h2>Less switching.<br /><em>More doing.</em></h2></div><div className="about-intro-copy"><p>CipherPay was created around a straightforward idea: everyday digital life should not require a different app for every task.</p><p>Instead of separating your wallet, transfers, digital services, social tools and communication, CipherPay brings them together behind one account and one balance.</p></div></section>

    <section className="about-features about-width"><div className="about-section-head"><span className="about-section-label">THE PLATFORM</span><h2>What you can do with CipherPay.</h2><p>Our platform keeps expanding, but the goal stays the same: useful tools, one account, less friction.</p></div>
      <div className="about-feature-groups">{featureGroups.map(group => <section className="about-feature-group" key={group.label}><div className="about-group-head"><span>{group.label}</span><h3>{group.title}</h3></div><div className="about-feature-grid">{group.items.map(([title, text, Icon]) => { const FeatureIcon = Icon as typeof WalletCards; return <article className="about-feature-card" key={title as string}><span className="about-feature-icon"><FeatureIcon size={18} /></span><div><h4>{title as string}</h4><p>{text as string}</p></div></article>; })}</div></section>)}</div>
    </section>

    <section className="about-security about-width"><div className="about-security-copy"><span className="about-section-label">BUILT AROUND CONTROL</span><h2>Your account should feel like <em>yours.</em></h2><p>CipherPay is designed around clear balances, transaction history, account controls and protected flows. We aim to make important actions understandable before you confirm them.</p></div><div className="about-security-points"><div><ShieldCheck size={18} /><span><b>Protected account flows</b><small>Authentication and sensitive actions are handled through dedicated account flows.</small></span></div><div><LockKeyhole size={18} /><span><b>Control over your activity</b><small>Keep track of funding, transfers, purchases and other account activity.</small></span></div><div><Check size={18} /><span><b>Designed for clarity</b><small>Important balances, statuses and confirmations are kept visible and easy to understand.</small></span></div></div></section>

    <section className="about-founder about-width"><div className="about-founder-mark">PU</div><div className="about-founder-copy"><span className="about-section-label">THE FOUNDER</span><h2>Patrick Udo</h2><p className="about-founder-role">Founder, CipherPay</p><p>CipherPay is founded by Patrick Udo, with a focus on building a practical digital platform that brings everyday financial and digital services together in one place.</p></div></section>

    <section className="about-final about-width"><span className="about-kicker"><i /> READY WHEN YOU ARE</span><h2>Everything you need.<br /><em>One account.</em></h2><div><Link href="/register" className="about-cta large">Create your account <ArrowRight size={17} /></Link><Link href="/" className="about-secondary">Back to home</Link></div></section>
    <footer className="about-footer about-width"><span>© {new Date().getFullYear()} CipherPay</span><span>Built for the way life moves.</span></footer>
  </main>;
}
