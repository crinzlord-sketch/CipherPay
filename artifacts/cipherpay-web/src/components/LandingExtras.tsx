import './landing-extras.css';

const logo = (code: string) => 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/' + code + '.svg';

export default function LandingExtras() {
  const coins = [
    ['btc','BTC','Bitcoin'],['eth','ETH','Ethereum'],['sol','SOL','Solana'],['usdt','USDT','Tether'],
    ['usdc','USDC','USD Coin'],['bnb','BNB','BNB Chain'],['trx','TRX','TRON'],['xlm','XLM','Stellar'],
  ];
  return <>
    <section className="cp-section cp-crypto-landing" id="crypto">
      <div className="cp-crypto-landing-head"><div><span className="cp-kicker">CIPHERPAY / CRYPTO</span><h2>Digital assets.<br/><span>Built into the flow.</span></h2><p>Hold, send, receive and swap supported assets, then turn crypto into NGN through CipherPay’s off-ramp infrastructure. Blockchain network fees are paid by the user.</p></div><div className="cp-crypto-status"><span className="cp-live-dot"/><b>COMING SOON</b><small>Provider onboarding in progress</small></div></div>
      <div className="cp-crypto-showcase">
        <div className="cp-crypto-orbit-stage"><div className="cp-crypto-orbit-ring ring-one"/><div className="cp-crypto-orbit-ring ring-two"/><div className="cp-crypto-core"><span>CP</span><small>CRYPTO VAULT</small><b>∞</b></div>{coins.slice(0,4).map(([code])=><div className="cp-crypto-coin" key={code}><img src={logo(code)} alt="" /></div>)}</div>
        <div className="cp-crypto-assets">{coins.map(([code,symbol,name])=><div className="cp-crypto-asset" key={symbol}><img src={logo(code)} alt={symbol}/><span><b>{symbol}</b><small>{name}</small></span><i>Preview</i></div>)}</div>
      </div>
      <div className="cp-crypto-flow"><span><b>01</b> Receive</span><span><b>02</b> Hold</span><span><b>03</b> Send</span><span><b>04</b> Swap</span><span><b>05</b> Sell → NGN</span></div>
    </section>
    <section className="cp-section cp-about-section" id="about">
      <div className="cp-about-grid"><div><span className="cp-kicker">ABOUT CIPHERPAY</span><h2>One platform.<br/><span>A bigger idea.</span></h2><p>CipherPay is being built as a modern financial and digital-services platform — bringing payments, wallet tools, communication, everyday services and digital assets into one controlled experience.</p><p>We’re designing the infrastructure around fast flows, clear records, strong account protection and an architecture that can grow as new providers and services come online.</p></div><div className="cp-founder-card"><div className="cp-founder-avatar">PU</div><span>FOUNDER</span><h3>Patrick Udo</h3><p>Founder of CipherPay</p><div className="cp-founder-line"/><small>Building CipherPay with a focus on useful financial infrastructure, thoughtful product design and a platform that can scale beyond one service.</small></div></div>
      <div className="cp-about-metrics"><div><b>01</b><span>Wallet & payments</span></div><div><b>02</b><span>Digital services</span></div><div><b>03</b><span>Communication</span></div><div><b>04</b><span>Digital assets</span></div></div>
    </section>
  </>;
}
