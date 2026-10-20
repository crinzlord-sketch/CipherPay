import { useEffect, useState } from 'react';
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

const adScenes = [
  { eyebrow: 'CIPHERPAY', title: 'Your digital life,', accent: 'in motion.', detail: 'One account. A whole world of connected tools.', chips: ['ONE ACCOUNT', 'BUILT TO MOVE'], visual: 'launch' },
  { eyebrow: 'MONEY WITHOUT THE MESS', title: 'Fund. Send.', accent: 'Stay in control.', detail: 'A wallet for funding, transfers and tracking your activity.', chips: ['WALLET', 'TRANSFERS', 'ACTIVITY'], visual: 'wallet' },
  { eyebrow: 'CONNECTED WORLD', title: 'Numbers without', accent: 'the hassle.', detail: 'SMS verification, long-term numbers and international eSIM options.', chips: ['SMS VERIFY', 'eSIM', 'LONG-TERM NUMBERS'], visual: 'connect' },
  { eyebrow: 'EMAIL TOOLS', title: 'A smarter inbox', accent: 'for quick tasks.', detail: 'Temporary email and Email Pro tools, together in one place.', chips: ['TEMP EMAIL', 'EMAIL PRO'], visual: 'email' },
  { eyebrow: 'EVERYDAY DATA', title: 'Stay connected.', accent: 'Keep moving.', detail: 'Explore supported mobile data bundles from your CipherPay account.', chips: ['DATA BUNDLES', 'EASY ACCESS'], visual: 'data' },
  { eyebrow: 'SOCIAL POWER', title: 'Build your', accent: 'online presence.', detail: 'Social Boost orders with status tracking and recent activity.', chips: ['SOCIAL BOOST', 'ORDER TRACKING'], visual: 'boost' },
  { eyebrow: 'SOCIAL MARKETPLACE', title: 'Buy and sell', accent: 'with purpose.', detail: 'Browse available social accounts and seller listings in one marketplace.', chips: ['SOCIAL ACCOUNTS', 'SELLER TOOLS'], visual: 'market' },
  { eyebrow: 'STAY IN TOUCH', title: 'Find your people.', accent: 'Keep the conversation.', detail: 'Find CipherPay users and chat with messages, images, GIFs and replies.', chips: ['FIND & CHAT', 'REFERRALS'], visual: 'chat' },
  { eyebrow: 'WHAT COMES NEXT', title: 'One platform.', accent: 'More possibilities.', detail: 'Security-focused account controls today, with crypto marked as coming soon.', chips: ['ACCOUNT CONTROLS', 'CRYPTO COMING SOON'], visual: 'future' },
];

function CipherPayAdReel() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scene = adScenes[sceneIndex];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 0.1;
        if (next >= 36) {
          setPlaying(false);
          return 36;
        }
        setSceneIndex(Math.min(adScenes.length - 1, Math.floor(next / 4)));
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing]);
  const start = () => {
    if (elapsed >= 36) { setElapsed(0); setSceneIndex(0); }
    setPlaying(true);
  };
  const reset = () => { setPlaying(false); setElapsed(0); setSceneIndex(0); };
  const fullscreen = () => {
    const element = document.getElementById('cipherpay-ad-reel');
    if (element?.requestFullscreen) void element.requestFullscreen();
  };
  return <section className="about-ad-section about-width" aria-label="CipherPay animated advertisement">
    <div className="about-ad-heading"><span className="about-section-label">THE CIPHERPAY REEL</span><h2>36 seconds.<br/><em>Every side of CipherPay.</em></h2><p>Play the cinematic feature showcase, then screen-record it for your social ads.</p></div>
    <div id="cipherpay-ad-reel" className={`about-ad-reel ${playing ? 'is-playing' : ''}`}>
      <div className="about-ad-stars" aria-hidden="true" />
      <div className="about-ad-orb about-ad-orb-one" aria-hidden="true" />
      <div className="about-ad-orb about-ad-orb-two" aria-hidden="true" />
      <div className="about-ad-topline"><span><i/> CIPHERPAY / FEATURE FILM</span><span>00:{String(Math.max(0, Math.ceil(36-elapsed))).padStart(2,'0')}</span></div>
      <div className="about-ad-content" key={scene.visual}>
        <div className="about-ad-copy"><span className="about-ad-eyebrow">{scene.eyebrow}</span><h3>{scene.title}<br/><em>{scene.accent}</em></h3><p>{scene.detail}</p><div className="about-ad-chips">{scene.chips.map(chip=><span key={chip}>{chip}</span>)}</div></div>
        <div className={`about-ad-device device-${scene.visual}`} aria-hidden="true">
          <div className="about-ad-device-back" />
          <div className="about-ad-screen">
            <div className="about-ad-screen-top"><span className="about-ad-mini-logo">CP</span><span>cipherpay</span><i>•••</i></div>
            {scene.visual === 'wallet' ? <>
              <small>AVAILABLE BALANCE</small><strong className="ad-balance">₦ 24,680.00</strong><div className="ad-action-row"><b>↗ Send</b><b>＋ Fund</b><b>↗ Activity</b></div><div className="ad-chart"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
            </> : scene.visual === 'connect' ? <>
              <div className="ad-ui-list"><b>Global services</b><span>◉ SMS verification <i>Ready</i></span><span>◎ International eSIM <i>Explore</i></span><span>▣ Long-term numbers <i>Manage</i></span></div>
            </> : scene.visual === 'email' ? <>
              <div className="ad-email-icon">✉</div><b className="ad-ui-title">Your inbox, simplified.</b><span className="ad-ui-line"/><span className="ad-ui-line short"/><div className="ad-mini-pill">TEMP EMAIL · EMAIL PRO</div>
            </> : scene.visual === 'data' ? <>
              <div className="ad-data-orb">5G</div><b className="ad-ui-title">Stay connected</b><div className="ad-data-bars"><i/><i/><i/><i/><i/><i/><i/></div><div className="ad-mini-pill">DATA BUNDLES</div>
            </> : scene.visual === 'boost' ? <>
              <div className="ad-social-head"><span>◎</span><b>Social Boost</b><i>↗</i></div><div className="ad-growth">+ <strong>2,480</strong><small>growth in motion</small></div><div className="ad-progress"><i/></div><div className="ad-mini-pill">ORDER TRACKING</div>
            </> : scene.visual === 'market' ? <>
              <div className="ad-market-grid"><span>◎<b>Social</b></span><span>✉<b>Email</b></span><span>◉<b>Accounts</b></span><span>↗<b>Seller tools</b></span></div><div className="ad-mini-pill">MARKETPLACE</div>
            </> : scene.visual === 'chat' ? <>
              <div className="ad-chat-bubble">Hey! You on CipherPay? <small>Now</small></div><div className="ad-chat-bubble outgoing">Yeah, let's connect. <small>✓✓</small></div><div className="ad-chat-tools"><span>＋</span><span>GIF</span><span>☺</span><span>➤</span></div>
            </> : scene.visual === 'future' ? <>
              <div className="ad-future-mark">CP</div><b className="ad-ui-title">Everything moves.</b><div className="ad-mini-pill">CRYPTO · COMING SOON</div>
            </> : <>
              <div className="ad-launch-mark">CP</div><b className="ad-launch-title">One account.<br/>Infinite moves.</b><div className="ad-mini-pill">WELCOME TO CIPHERPAY</div>
            </>}
          </div>
          <div className="about-ad-device-reflection" />
        </div>
      </div>
      <div className="about-ad-bottom"><div className="about-ad-progress"><i style={{width:`${Math.min(100,elapsed/36*100)}%`}}/></div><div className="about-ad-controls"><span>SCENE {String(sceneIndex+1).padStart(2,'0')} / {String(adScenes.length).padStart(2,'0')}</span><div><button type="button" onClick={reset}>↺ Restart</button><button type="button" onClick={fullscreen}>⛶ Full screen</button><button type="button" className="about-ad-play" onClick={playing ? () => setPlaying(false) : start}>{playing ? 'Ⅱ Pause' : elapsed >= 36 ? '↻ Replay' : '▶ Play ad'}</button></div></div></div>
    </div>
    <p className="about-ad-note">Tip: tap <b>Full screen</b>, play the reel, and screen-record the 36-second run. Use a screen recorder at the highest available quality.</p>
  </section>;
}

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

    <CipherPayAdReel />

    <div className="about-marquee" aria-hidden="true"><div>{[...marquee, ...marquee].map((item, i) => <span key={`${item}-${i}`}>{item}<b>◆</b></span>)}</div></div>

    <section className="about-intro about-width">
      <div><span className="about-section-label">THE IDEA</span><h2>Less switching.<br /><em>More doing.</em></h2></div>
      <div className="about-intro-copy">
        <p>CipherPay was created around a straightforward idea: everyday digital life should not require a different app for every task.</p>
        <p>Instead of separating your wallet, transfers, digital services, social tools and communication, CipherPay brings them together behind one account and one balance.</p>
        <div className="about-intro-stats"><span><b>01</b><small>ACCOUNT</small></span><span><b>∞</b><small>POSSIBILITIES</small></span><span><b>24/7</b><small>ACCESS</small></span></div>
      </div>
    </section>

    <section className="about-features about-width">
      <div className="about-section-head">
        <div><span className="about-section-label">THE PLATFORM</span><h2>Not another boring dashboard.</h2></div>
        <p>Every part is designed around the same idea: useful tools, one account, less friction.</p>
      </div>
      <div className="about-feature-groups">
        {featureGroups.map((group, groupIndex) => <section className={`about-feature-group accent-${group.accent}`} key={group.label}>
          <div className="about-group-head"><div><span>{group.label}</span><h3>{group.title}</h3></div></div>
          <div className="about-feature-grid">{group.items.map(([title, text, Icon], index) => {
            const FeatureIcon = Icon as typeof WalletCards;
            return <article className="about-feature-card" key={title as string}>
              
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
        <span className="about-section-label">BUILT AROUND CONTROL</span>
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
      <div className="about-founder-visual">
        <img src="https://images.unsplash.com/photo-1510511459019-5dda7724fd87?auto=format&fit=crop&w=1000&q=85" alt="Technology workspace glowing with code and computer screens" loading="lazy" />
        <div className="about-founder-glass"><span>CP / FOUNDER</span><strong>BUILD<br />THE FUTURE</strong><small>TECH · SYSTEMS · VISION</small></div>
        <i className="about-founder-orbit orbit-one" /><i className="about-founder-orbit orbit-two" />
      </div>
      <div className="about-founder-copy">
        <span className="about-section-label">THE FOUNDER</span>
        <h2>Patrick Udo <em>(Crinz)</em></h2>
        <p className="about-founder-role">Founder of CipherPay · Founder of Cipher Technologies</p>
        <p>Patrick Udo, known as Crinz, founded CipherPay and Cipher Technologies with a vision to build practical digital products that bring financial tools, online services and modern technology closer together.</p>
        <div className="about-founder-tags"><span>FOUNDER</span><span>PRODUCT BUILDER</span><span>TECHNOLOGY</span></div>
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
