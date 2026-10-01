import './landing-extras.css';

const logo = (code: string) => 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/' + code + '.svg';
const coins = [
  ['btc','BTC','Bitcoin'], ['eth','ETH','Ethereum'], ['sol','SOL','Solana'], ['usdt','USDT','Tether'],
  ['usdc','USDC','USD Coin'], ['bnb','BNB','BNB'], ['xrp','XRP','XRP'], ['doge','DOGE','Dogecoin'],
];

export default function LandingExtras() {
  return <section className="cp-section cp-crypto-landing" id="crypto">
    <div className="cp-crypto-landing-head"><div><span className="cp-kicker">CIPHERPAY / CRYPTO</span><h2>Digital assets.<br/><span>Built beautifully.</span></h2><p>Live market visibility, a multi-asset wallet and simple actions — inside the same CipherPay experience.</p></div><span className="cp-crypto-head-badge"><i/> LIVE MARKETS</span></div>
    <div className="cp-landing-crypto-layout">
      <div className="cp-landing-wallet-3d">
        <div className="cp-wallet-3d-shadow"/>
        <div className="cp-wallet-3d-face">
          <div className="cp-wallet-3d-top"><span>CRYPTO / PORTFOLIO</span><b>LIVE</b></div>
          <div className="cp-wallet-3d-balance"><small>YOUR BALANCE</small><strong>₦0.00</strong><span>0 assets held</span></div>
          <div className="cp-wallet-3d-chart"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
          <div className="cp-wallet-3d-coins">{coins.slice(0,3).map(([code,symbol,name])=><div key={symbol}><img src={logo(code)}/><span><b>{symbol}</b><small>{name}</small></span><em>—</em></div>)}</div>
          <div className="cp-wallet-3d-actions"><span>↓ Receive</span><span>↑ Send</span><span>↔ Swap</span></div>
        </div>
      </div>
      <div className="cp-landing-crypto-orbit">
        <div className="cp-orbit-stage-clean"><div className="cp-orbit-line one"/><div className="cp-orbit-line two"/><div className="cp-crypto-3d-core"><span>CP</span><small>CRYPTO</small></div>
          {coins.slice(0,6).map(([code,symbol],i)=><div className={`cp-clean-coin clean-${i}`} key={code}><img src={logo(code)} alt={symbol}/></div>)}
        </div>
        <div className="cp-orbit-caption"><b>Multi-asset</b><span>BTC · ETH · SOL · stablecoins & more</span></div>
      </div>
    </div>
    <div className="cp-landing-asset-strip">{coins.map(([code,symbol,name])=><div key={symbol}><img src={logo(code)} alt={symbol}/><span><b>{symbol}</b><small>{name}</small></span></div>)}</div>
  </section>;
}
