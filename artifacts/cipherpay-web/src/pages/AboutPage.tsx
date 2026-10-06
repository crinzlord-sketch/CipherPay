import { ArrowLeft, ArrowRight, ArrowUpRight, Banknote, Bitcoin, Check, Globe2, LockKeyhole, MessageSquare, Send, ShieldCheck, Smartphone, ShoppingBag, WalletCards, Wifi, Mail, UsersRound, Megaphone, Zap, CircleDollarSign, Boxes } from 'lucide-react';
import { Link } from 'wouter';
import './about.css';

const featureGroups = [
  { label: 'MONEY', title: 'A wallet built for everyday movement.', accent: 'violet', items: [
    ['Wallet funding', 'Fund your CipherPay wallet and keep your wallet activity in one clear place.', WalletCards],
    ['Send money', 'Move money to other CipherPay users through a focused transfer flow.', Send],
    ['Bills & payments', 'Pay supported everyday bills and services directly from your wallet.', Banknote],
    ['Referrals', 'Invite others and earn through the CipherPay referral experience.', UsersRound],
  ]},
  { label: 'DIGITAL SERVICES', title: 'The tools you normally need scattered across different apps.', accent: 'orange', items: [
    ['SMS verification', 'Access SMS verification services across supported countries and platforms.', MessageSquare],
    ['International eSIM', 'Explore international eSIM options from one CipherPay account.', Globe2],
    ['Long-term numbers', 'Get longer-term phone number options for supported use cases.', Smartphone],
    ['Temporary email', 'Create temporary email addresses when you need a quick, disposable inbox.', Mail],
    ['Email Pro', 'Use CipherPay email tools from the same account.', Mail],
    ['Data bundles', 'Purchase supported mobile data bundles from your wallet.', Wifi],
  ]},
  { label: 'SOCIAL', title: 'Social tools with buying and growth services in one place.', accent: 'pink', items: [
    ['Social Boost', 'Purchase supported social growth services and track your orders.', Megaphone],
    ['Social Accounts', 'Browse available social media account inventory by platform and country.', ShoppingBag],
    ['Seller marketplace', 'Approved sellers can list social account inventory and manage withdrawals.', UsersRound],
    ['Find & chat', 'Find other CipherPay users by CipherPay code and chat with text, images, GIFs and replies.', MessageSquare],
  ]},
  { label: 'CRYPTO', title: 'A multi-asset direction built into the platform.', accent: 'blue', items: [
    ['Crypto wallet', 'CipherPay is being built to support digital assets alongside everyday money.', Bitcoin],
    ['Send, receive & swap', 'The crypto experience is designed around simple asset movement and management.', ArrowRight],
  ]},
];

const marquee = ['MONEY', 'PAYMENTS', 'CRYPTO', 'eSIM', 'SOCIAL', 'CHAT', 'NUMBERS', 'EMAIL', 'DATA'];

export default function AboutPage() {
  return <main className="about-page">
    <div className="about-noise" />
    <div className="about-aurora about-aurora-one" />
    <div className="about-aurora about-aurora-two" />
    <div className="about-grid" />

    <header className="about-nav">
      <Link href="/" className="about-back"><ArrowLeft size={16} /> Back to CipherPay</Link>
      <Link href="/" className="about-brand">Cipher<span>Pay</span></Link>
      <Link href="/register" className="about-cta">Create account <ArrowRight size={15} /></Link>
    </header>

    <section className="about-hero about-width">
      <div className="about-hero-copy">
        <span className="about-kicker"><b /> CIPHERPAY / ABOUT</span>
        <h1>One platform.<br /><span>Everything moves.</span></h1>
        <p>CipherPay brings money, digital services, communication and commerce into one account — designed to feel simple even when the work behind it is not.</p>
        <div className="about-hero-actions">
          <Link href="/register" className="about-hero-button">Start using CipherPay <ArrowRight size={16} /></Link>

        </div>
      </div>

      <div className="about-hero-stage" aria-hidden="true">
        <div className="about-orbit orbit-a" />
        <div className="about-orbit orbit-b" />
        <div className="about-orbit orbit-c" />
        <div className="about-hero-glow" />
        <div className="about-core-card">
          <div className="core-top"><span>CIPHERPAY</span><span className="core-chip">CP</span></div>
          <div className="core-balance"><small>ONE ACCOUNT</small><strong>∞</strong></div>
          <div className="core-bottom"><span>PAY · SEND · BUILD</span><Zap size={15} /></div>
        </div>
        <div className="about-float about-float-one"><CircleDollarSign size={15} /><span><b>Money</b><small>in one place</small></span></div>
        <div className="about-float about-float-two"><Boxes size={15} /><span><b>Services</b><small>all connected</small></span></div>
      </div>
    </section>

    <div className="about-marquee" aria-hidden="true"><div>{[...marquee, ...marquee].map((item, i) => <span key={`${item}-${i}`}>{item}<b>◆</b></span>)}</div></div>

    <section className="about-intro about-width">
      <div><span className="about-section-label">THE IDEA / 01</span><h2>Less switching.<br /><em>More doing.</em></h2></div>
      <div className="about-intro-copy">
        <p>CipherPay was created around a straightforward idea: everyday digital life should not require a different app for every task.</p>
        <p>Instead of separating your wallet, transfers, digital services, social tools and communication, CipherPay brings them together behind one account and one balance.</p>
        <div className="about-intro-stats"><span><b>01</b><small>ACCOUNT</small></span><span><b>∞</b><small>POSSIBILITIES</small></span><span><b>24/7</b><small>ACCESS</small></span></div>
      </div>
    </section>

    <section className="about-features about-width">
      <div className="about-section-head">
        <div><span className="about-section-label">THE PLATFORM / 02</span><h2>Not another boring dashboard.</h2></div>
        <p>Every part is designed around the same idea: useful tools, one account, less friction.</p>
      </div>
      <div className="about-feature-groups">
        {featureGroups.map((group, groupIndex) => <section className={`about-feature-group accent-${group.accent}`} key={group.label}>
          <div className="about-group-head"><span className="group-number">0{groupIndex + 1}</span><div><span>{group.label}</span><h3>{group.title}</h3></div></div>
          <div className="about-feature-grid">{group.items.map(([title, text, Icon], index) => {
            const FeatureIcon = Icon as typeof WalletCards;
            return <article className="about-feature-card" key={title as string}>
              <span className="about-feature-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="about-feature-icon"><FeatureIcon size={19} /></span>
              <div><h4>{title as string}</h4><p>{text as string}</p></div>
              <ArrowUpRight />
            </article>;
          })}</div>
        </section>)}
      </div>
    </section>

    <section className="about-security about-width">
      <div className="about-security-copy">
        <span className="about-section-label">BUILT AROUND CONTROL / 03</span>
        <h2>Your account should feel like <em>yours.</em></h2>
        <p>CipherPay is designed around clear balances, transaction history, account controls and protected flows. We aim to make important actions understandable before you confirm them.</p>
      </div>
      <div className="about-security-points">
        <div><ShieldCheck size={18} /><span><b>Protected account flows</b><small>Authentication and sensitive actions are handled through dedicated account flows.</small></span></div>
        <div><LockKeyhole size={18} /><span><b>Control over your activity</b><small>Keep track of funding, transfers, purchases and other account activity.</small></span></div>
        <div><Check size={18} /><span><b>Designed for clarity</b><small>Important balances, statuses and confirmations are kept visible and easy to understand.</small></span></div>
      </div>
    </section>

    <section className="about-founder about-width">
      <div className="about-founder-mark"><span>PU</span><i /></div>
      <div className="about-founder-copy">
        <span className="about-section-label">THE FOUNDER / 04</span>
        <h2>Patrick Udo</h2>
        <p className="about-founder-role">Founder, CipherPay</p>
        <p>CipherPay is founded by Patrick Udo, with a focus on building a practical digital platform that brings everyday financial and digital services together in one place.</p>
      </div>
    </section>

    <section className="about-final about-width">
      <div className="about-final-glow" />
      <span className="about-kicker"><b /> READY WHEN YOU ARE</span>
      <h2>Everything you need.<br /><span>One account.</span></h2>
      <p>Money, services and digital life — moving together.</p>
      <div><Link href="/register" className="about-cta large">Create your account <ArrowRight size={17} /></Link><Link href="/" className="about-secondary">Back to home</Link></div>
      <strong className="about-wordmark">CIPHERPAY</strong>
    </section>

    <footer className="about-footer about-width"><span>© {new Date().getFullYear()} CipherPay</span><span>Built for the way life moves.</span></footer>
  </main>;
}
