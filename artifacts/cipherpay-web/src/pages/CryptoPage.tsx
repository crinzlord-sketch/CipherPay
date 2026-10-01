import { ArrowDownLeft, ArrowLeft, ArrowUpRight, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import './crypto.css';

const assets = [
  { symbol:'BTC',name:'Bitcoin',network:'Bitcoin',icon:'btc' },{ symbol:'ETH',name:'Ethereum',network:'Ethereum',icon:'eth' },
  { symbol:'SOL',name:'Solana',network:'Solana',icon:'sol' },{ symbol:'USDT',name:'Tether',network:'TRON / Solana',icon:'usdt' },
  { symbol:'USDC',name:'USD Coin',network:'Base / Ethereum / Solana',icon:'usdc' },{ symbol:'BNB',name:'BNB',network:'BNB Chain',icon:'bnb' },
  { symbol:'TRX',name:'TRON',network:'TRON',icon:'trx' },{ symbol:'XLM',name:'Stellar',network:'Stellar',icon:'xlm' },
];
const icon=(code:string)=>`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/${code}.svg`;

export default function CryptoPage(){
 const [panel,setPanel]=useState<'send'|'receive'|'swap'|'sell'|null>(null);
 const [asset,setAsset]=useState(assets[0]);
 return <div className="cp-crypto-page">
  <div className="cp-crypto-top"><Link href="/" className="cp-crypto-back"><ArrowLeft size={15}/> Back</Link><span className="cp-crypto-badge"><i/> Coming soon</span></div>
  <section className="cp-crypto-hero-glass">
   <div className="cp-crypto-hero-copy"><span className="cp-kicker">CIPHERPAY / CRYPTO</span><h1>Move crypto.<br/><span>Move freely.</span></h1><p>Multi-asset wallet infrastructure with user-paid network fees and crypto → NGN off-ramp.</p>
    <div className="cp-crypto-actions"><button onClick={()=>setPanel('receive')}><ArrowDownLeft/>Receive</button><button onClick={()=>setPanel('send')}><ArrowUpRight/>Send</button><button onClick={()=>setPanel('swap')}><RefreshCw/>Swap</button><button onClick={()=>setPanel('sell')}><b>₦</b>Sell</button></div>
   </div>
   <div className="cp-crypto-hero-visual"><div className="cp-hero-orbit a"/><div className="cp-hero-orbit b"/><div className="cp-hero-core"><b>CP</b><small>CRYPTO</small></div>{assets.slice(0,5).map((a,i)=><img className={`cp-hero-coin hcoin-${i}`} key={a.symbol} src={icon(a.icon)} alt={a.symbol}/>)}</div>
  </section>
  <div className="cp-crypto-statbar"><span><ShieldCheck/> <b>User-paid gas</b></span><span><WalletCards/> <b>One CipherPay KYC</b></span><span><b>Multi-asset</b></span></div>
  <section className="cp-crypto-assets-glass"><div className="cp-crypto-section-title"><span>ASSETS</span><b>Pick an asset</b></div><div className="cp-asset-grid">{assets.map(a=><button className={`cp-asset-tile ${asset.symbol===a.symbol?'selected':''}`} key={a.symbol} onClick={()=>setAsset(a)}><img src={icon(a.icon)} alt={a.symbol}/><span><b>{a.symbol}</b><small>{a.name}</small></span></button>)}</div></section>
  {panel&&<div className="cp-crypto-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setPanel(null)}><div className="cp-crypto-modal"><button className="cp-crypto-close" onClick={()=>setPanel(null)}>×</button><span className="cp-kicker">PREVIEW / {panel}</span><h2>{panel==='sell'?'Sell to NGN':panel==='swap'?'Swap crypto':panel==='send'?'Send crypto':'Receive crypto'}</h2><div className="cp-modal-asset"><img src={icon(asset.icon)} alt={asset.symbol}/><span><b>{asset.name}</b><small>{asset.symbol} · {asset.network}</small></span></div><div className="cp-modal-field">Amount <strong>0.00</strong></div><button className="cp-modal-disabled">Available after provider onboarding</button></div></div>}
 </div>;
}
