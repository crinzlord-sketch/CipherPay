import './landing-extras.css';

const logo = (code: string) => 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/' + code + '.svg';

const coins = [
  ['btc','BTC','Bitcoin'], ['eth','ETH','Ethereum'], ['sol','SOL','Solana'], ['usdt','USDT','Tether'],
  ['usdc','USDC','USD Coin'], ['bnb','BNB','BNB'], ['trx','TRX','TRON'], ['xlm','XLM','Stellar'],
];

export default function LandingExtras() {
  return <>
    <section className="cp-section cp-crypto-landing" id="crypto">
      <div className="cp-crypto-landing-copy">
        <span className="cp-kicker">CIPHERPAY / CRYPTO</span>
        <h2>Crypto, <span>your way.</span></h2>
        <div className="cp-crypto-mini-row"><span>Send</span><i>•</i><span>Receive</span><i>•</i><span>Swap</span><i>•</i><span>NGN</span></div>
      </div>
      <div className="cp-crypto-glass">
        <div className="cp-crypto-glow" />
        <div className="cp-crypto-orbit"><div className="cp-orbit orbit-a" /><div className="cp-orbit orbit-b" /><div className="cp-crypto-center"><b>CP</b><small>CRYPTO</small></div>
          {coins.slice(0,6).map(([code,symbol], i) => <div className={`cp-landing-coin coin-${i}`} key={code}><img src={logo(code)} alt={symbol} /></div>)}
        </div>
        <div className="cp-crypto-glass-assets">
          {coins.map(([code,symbol,name]) => <div className="cp-glass-asset" key={symbol}><img src={logo(code)} alt={symbol} /><span><b>{symbol}</b><small>{name}</small></span></div>)}
        </div>
      </div>
      <div className="cp-crypto-chipbar"><span>Multi-asset</span><span>User-paid gas</span><span>Crypto → NGN</span><span>Coming soon</span></div>
    </section>

    <section className="cp-section cp-about-section" id="about">
      <div className="cp-about-glass">
        <div className="cp-about-copy"><span className="cp-kicker">ABOUT</span><h2>Built by <span>Patrick Udo.</span></h2><p>CipherPay brings payments, digital services, communication and digital assets into one modern experience.</p></div>
        <div className="cp-founder-orb"><div className="cp-founder-ring" /><div className="cp-founder-avatar">PU</div><small>FOUNDER</small><b>Patrick Udo</b></div>
      </div>
    </section>
  </>;
}
