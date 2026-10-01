import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, Coins, Copy, RefreshCw, ShieldCheck, Sparkles, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import './crypto.css';

const assets = [
  { symbol: 'BTC', name: 'Bitcoin', network: 'Bitcoin', icon: 'btc' },
  { symbol: 'ETH', name: 'Ethereum', network: 'Ethereum', icon: 'eth' },
  { symbol: 'SOL', name: 'Solana', network: 'Solana', icon: 'sol' },
  { symbol: 'USDT', name: 'Tether', network: 'TRON / Solana', icon: 'usdt' },
  { symbol: 'USDC', name: 'USD Coin', network: 'Base / Ethereum / Solana', icon: 'usdc' },
  { symbol: 'BNB', name: 'BNB', network: 'BNB Chain', icon: 'bnb' },
  { symbol: 'TRX', name: 'TRON', network: 'TRON', icon: 'trx' },
  { symbol: 'XLM', name: 'Stellar', network: 'Stellar', icon: 'xlm' },
];

function AssetIcon({ code, alt = '' }: { code: string; alt?: string }) {
  return <img className="cp-crypto-page-icon" src={`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/${code}.svg`} alt={alt} onError={(event) => { event.currentTarget.style.display = 'none'; }} />;
}

export default function CryptoPage() {
  const [panel, setPanel] = useState<'send' | 'receive' | 'swap' | 'sell' | null>(null);
  const [asset, setAsset] = useState(assets[0]);
  const [copied, setCopied] = useState(false);

  const copyPreview = async () => {
    await navigator.clipboard?.writeText('Provider wallet address will appear here');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return <div className="cp-crypto-page">
    <div className="cp-crypto-page-hero">
      <div>
        <Link href="/" className="cp-crypto-back"><ArrowLeft size={15} /> Landing</Link>
        <div className="cp-crypto-eyebrow"><span className="cp-crypto-live-dot" /> CRYPTO / BUILDING</div>
        <h1>Your assets.<br /><span>Your control.</span></h1>
        <p>The CipherPay crypto layer is being built for multi-asset wallets, user-paid network fees, crypto-to-crypto swaps and crypto-to-NGN off-ramping.</p>
        <div className="cp-crypto-hero-actions">
          <button onClick={() => setPanel('receive')}><ArrowDownLeft size={16} /> Receive</button>
          <button onClick={() => setPanel('send')}><ArrowUpRight size={16} /> Send</button>
          <button onClick={() => setPanel('swap')}><RefreshCw size={16} /> Swap</button>
          <button onClick={() => setPanel('sell')}><span>₦</span> Sell to NGN</button>
        </div>
      </div>
      <div className="cp-crypto-page-vault" aria-hidden="true">
        <div className="cp-vault-ring ring-a" /><div className="cp-vault-ring ring-b" />
        <div className="cp-vault-core"><Coins size={30} /><b>CP</b><small>CRYPTO ENGINE</small></div>
        {assets.slice(0, 4).map((item, i) => <div className={`cp-vault-coin coin-${i}`} key={item.symbol}><AssetIcon code={item.icon} /></div>)}
      </div>
    </div>

    <section className="cp-crypto-security-strip">
      <div><ShieldCheck size={18} /><span><b>User-paid network fees</b><small>CipherPay will not sponsor blockchain gas.</small></span></div>
      <div><Sparkles size={18} /><span><b>Provider-ready architecture</b><small>Sandbox now. Production provider later.</small></span></div>
      <div><WalletCards size={18} /><span><b>One CipherPay KYC</b><small>No separate crypto onboarding UX.</small></span></div>
    </section>

    <section className="cp-crypto-page-section">
      <div className="cp-crypto-section-head"><div><span>ASSET UNIVERSE</span><h2>Built beyond one coin.</h2><p>These are the planned asset surfaces. Live balances and blockchain actions remain locked until the production wallet/off-ramp provider is connected.</p></div><span className="cp-crypto-preview-pill">PREVIEW MODE</span></div>
      <div className="cp-crypto-page-assets">{assets.map((item) => <button className="cp-crypto-page-asset" key={item.symbol} onClick={() => setAsset(item)}><AssetIcon code={item.icon} alt={item.name} /><span><b>{item.name}</b><small>{item.symbol} · {item.network}</small></span><ArrowRight size={15} /></button>)}</div>
    </section>

    <section className="cp-crypto-page-section cp-crypto-flow-section">
      <div className="cp-crypto-section-head"><div><span>MONEY FLOW</span><h2>Crypto → NGN, without the mystery.</h2></div></div>
      <div className="cp-crypto-flow-cards">
        <article><b>01</b><h3>Wallet</h3><p>User receives or holds supported crypto in the CipherPay wallet layer.</p></article>
        <article><b>02</b><h3>Network</h3><p>When sending, the user signs and pays the blockchain network fee.</p></article>
        <article><b>03</b><h3>Off-ramp</h3><p>For a sale, CipherPay gets a live quote and routes the crypto through the connected provider.</p></article>
        <article><b>04</b><h3>NGN payout</h3><p>The quoted naira amount is sent to the user's verified Nigerian bank destination.</p></article>
      </div>
    </section>

    <section className="cp-crypto-page-section cp-crypto-admin-note">
      <div><span className="cp-crypto-lock"><ShieldCheck size={19} /></span><div><span>ADMIN CONTROL</span><h2>Crypto can be switched off instantly.</h2><p>If crypto is disabled in Admin Console → Service controls, users see a dedicated <b>Crypto is coming soon</b> experience instead of the wallet.</p></div></div>
      <Link href="/admin" className="cp-crypto-admin-link">Open admin console <ArrowRight size={15} /></Link>
    </section>

    {panel && <div className="cp-crypto-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
      <section className="cp-crypto-modal">
        <button className="cp-crypto-modal-close" onClick={() => setPanel(null)} aria-label="Close">×</button>
        <span className="cp-crypto-eyebrow">PREVIEW / {panel.toUpperCase()}</span>
        <h2>{panel === 'sell' ? 'Sell crypto for NGN' : panel === 'swap' ? 'Swap crypto' : panel === 'send' ? 'Send crypto' : 'Receive crypto'}</h2>
        <p>This is the production UX shell. Real asset movement is disabled until CipherPay's provider onboarding and wallet credentials are connected.</p>
        {panel === 'receive' ? <div className="cp-crypto-address"><span>Wallet address</span><b>Provider wallet address will appear here</b><button onClick={copyPreview}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div> : <div className="cp-crypto-preview-form"><div><AssetIcon code={asset.icon} alt={asset.name} /><span><b>{asset.name}</b><small>{asset.symbol} · {asset.network}</small></span></div><label>Amount<input placeholder="0.00" inputMode="decimal" disabled /></label>{panel === 'sell' && <div className="cp-crypto-quote"><span>Live NGN quote</span><b>Available after provider connection</b></div>}<button disabled>Continue when live <ArrowRight size={15} /></button></div>}
        <div className="cp-crypto-modal-note"><ShieldCheck size={15} /> No blockchain transaction will be created in preview mode.</div>
      </section>
    </div>}
  </div>;
}
