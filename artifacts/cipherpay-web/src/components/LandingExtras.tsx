import './landing-extras.css';

const logo = (code: string) => 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/' + code + '.svg';
const coins = [
  ['btc','BTC','Bitcoin'], ['eth','ETH','Ethereum'], ['sol','SOL','Solana'], ['usdt','USDT','Tether'],
  ['usdc','USDC','USD Coin'], ['bnb','BNB','BNB'], ['trx','TRX','TRON'], ['xlm','XLM','Stellar'],
];

export default function LandingExtras() {
  return <section className="cp-section cp-crypto-landing" id="crypto">
    <div className="cp-crypto-landing-copy">
      <span className="cp-kicker">CIPHERPAY / CRYPTO</span>
      <h2>Crypto, <span>your way.</span></h2>
      <div className="cp-crypto-mini-row"><span>Send</span><i>•</i><span>Receive</span><i>•</i><span>Swap</span><i>•</i><span>NGN</span></div>
    </div>

    <div className="cp-crypto-stage">
      <div className="cp-crypto-glass cp-wallet-mockup">
        <div className="cp-wallet-top"><span>CRYPTO WALLET</span><span className="cp-live-dot">● LIVE</span></div>
        <div className="cp-wallet-balance"><small>Total balance</small><strong>₦2,847,320<span>.45</span></strong><em>+8.42% <b>↗</b></em></div>
        <div className="cp-wallet-mini-chart"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
        <div className="cp-wallet-row"><div><img src={logo('btc')}/><span><b>Bitcoin</b><small>0.0842 BTC</small></span></div><strong>₦1,924,800</strong></div>
        <div className="cp-wallet-row"><div><img src={logo('eth')}/><span><b>Ethereum</b><small>0.621 ETH</small></span></div><strong>₦624,240</strong></div>
        <div className="cp-wallet-row"><div><img src={logo('sol')}/><span><b>Solana</b><small>1.842 SOL</small></span></div><strong>₦298,280</strong></div>
        <div className="cp-wallet-actions"><span>↓ Receive</span><span>↑ Send</span><span>↔ Swap</span></div>
      </div>

      <div className="cp-crypto-glass cp-crypto-orbit-card">
        <div className="cp-crypto-glow" />
        <div className="cp-crypto-orbit"><div className="cp-orbit orbit-a" /><div className="cp-orbit orbit-b" /><div className="cp-crypto-center"><b>CP</b><small>CRYPTO</small></div>
          {coins.slice(0,6).map(([code,symbol], i) => <div className={`cp-landing-coin coin-${i}`} key={code}><img src={logo(code)} alt={symbol} /></div>)}
        </div>
      </div>
    </div>

    <div className="cp-crypto-glass cp-assets-strip">
      <div className="cp-strip-title"><span>SUPPORTED ASSETS</span><b>One wallet. Multiple assets.</b></div>
      <div className="cp-crypto-glass-assets">
        {coins.map(([code,symbol,name]) => <div className="cp-glass-asset" key={symbol}><img src={logo(code)} alt={symbol} /><span><b>{symbol}</b><small>{name}</small></span></div>)}
      </div>
    </div>
  </section>;
}
