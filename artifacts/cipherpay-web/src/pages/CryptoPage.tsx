import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, CircleDollarSign, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useGetWallet } from '@workspace/api-client-react';
import { apiUrl } from './page-api';
import './crypto.css';

type Market = {
  id: string; symbol: string; name: string; image: string;
  priceNgn: number; priceUsd: number; change24h: number; marketCapNgn: number; marketCapUsd: number; volumeNgn: number; volumeUsd: number;
};

const assets = [
  { symbol:'BTC', name:'Bitcoin', network:'Bitcoin', icon:'btc', id:'bitcoin' },
  { symbol:'ETH', name:'Ethereum', network:'Ethereum', icon:'eth', id:'ethereum' },
  { symbol:'SOL', name:'Solana', network:'Solana', icon:'sol', id:'solana' },
  { symbol:'USDT', name:'Tether', network:'TRON / Solana', icon:'usdt', id:'tether' },
  { symbol:'USDC', name:'USD Coin', network:'Base / Ethereum / Solana', icon:'usdc', id:'usd-coin' },
  { symbol:'BNB', name:'BNB', network:'BNB Chain', icon:'bnb', id:'binancecoin' },
  { symbol:'XRP', name:'XRP', network:'XRP Ledger', icon:'xrp', id:'ripple' },
  { symbol:'DOGE', name:'Dogecoin', network:'Dogecoin', icon:'doge', id:'dogecoin' },
  { symbol:'ADA', name:'Cardano', network:'Cardano', icon:'ada', id:'cardano' },
  { symbol:'AVAX', name:'Avalanche', network:'Avalanche', icon:'avax', id:'avalanche-2' },
  { symbol:'TRX', name:'TRON', network:'TRON', icon:'trx', id:'tron' },
  { symbol:'XLM', name:'Stellar', network:'Stellar', icon:'xlm', id:'stellar' },
];
const icon = (code:string) => `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/${code}.svg`;
const usd = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const ngn = new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2});
const compact = new Intl.NumberFormat('en-NG',{notation:'compact',maximumFractionDigits:1});

export default function CryptoPage(){
  const wallet = useGetWallet({ query: { queryKey: ['/api/wallet'], staleTime: 20_000, refetchInterval: 30_000 } } as any);
  const [markets,setMarkets]=useState<Market[]>([]);
  const [selected,setSelected]=useState('BTC');
  const [marketLoading,setMarketLoading]=useState(true);
  const [marketError,setMarketError]=useState('');
  const [panel,setPanel]=useState<'send'|'receive'|'swap'|'sell'|null>(null);
  const [currency,setCurrency]=useState<'USD'|'NGN'>('USD');

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        setMarketError('');
        const token=window.localStorage.getItem('cipherpay_token');
        const response=await fetch(apiUrl('/api/crypto/markets'),{
          headers: token ? { Authorization:`Bearer ${token}` } : {},
          cache:'no-store',
        });
        if(!response.ok) throw new Error('Market data unavailable');
        const body=await response.json();
        if(active) setMarkets(Array.isArray(body?.data)?body.data:[]);
      }catch(error:any){ if(active) setMarketError(error?.message ?? 'Live prices are temporarily unavailable.'); }
      finally{ if(active) setMarketLoading(false); }
    };
    void load();
    const timer=window.setInterval(load,30_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);

  const selectedMarket=markets.find(item=>item.symbol===selected);
  const btcMarket=markets.find(item=>item.symbol==='BTC');
  const ngnPerUsd=btcMarket?.priceUsd ? btcMarket.priceNgn / btcMarket.priceUsd : 0;
  const money=(valueUsd:number,valueNgn:number)=>currency==='USD'?usd.format(valueUsd):ngn.format(valueNgn);
  const formatCash=(valueNgn:number)=>currency==='USD' && ngnPerUsd>0 ? usd.format(valueNgn/ngnPerUsd) : ngn.format(valueNgn);
  const cashBalance=Number((wallet.data as any)?.balance ?? 0);
  const topMarkets=useMemo(()=>markets.slice(0,12),[markets]);

  return <div className="cp-crypto-page">
    <div className="cp-crypto-top"><Link href="/" className="cp-crypto-back"><ArrowLeft size={15}/> Back</Link><span className="cp-crypto-live"><i/> Live market data</span></div>

    <section className="cp-crypto-dashboard">
      <div className="cp-crypto-dashboard-copy">
        <div className="cp-crypto-balance-hero">
          <div><span>YOUR CRYPTO BALANCE</span><strong>{currency==='USD'?'$0.00':'₦0.00'}</strong><small>0 assets held · Your wallet balance will appear here</small></div>
          <button type="button" className="cp-currency-switch" onClick={()=>setCurrency(currency==='USD'?'NGN':'USD')}><b>{currency}</b><span>⇄</span><em>{currency==='USD'?'NGN':'USD'}</em></button>
        </div>
        <span className="cp-kicker">CIPHERPAY / CRYPTO WALLET</span>
        <div className="cp-crypto-actions"><span className="cp-actions-label">WALLET ACTIONS</span>
          <button onClick={()=>setPanel('receive')}><ArrowDownLeft/>Receive</button>
          <button onClick={()=>setPanel('send')}><ArrowUpRight/>Send</button>
          <button onClick={()=>setPanel('swap')}><RefreshCw/>Swap</button>
          <button onClick={()=>setPanel('sell')}><b>₦</b>Sell to NGN</button>
        </div>
      </div>
SOL')!.priceNgn):'—'}</small></div>
      </div>
    </section>

    <section className="cp-crypto-market-section">
      <div className="cp-crypto-section-title"><div><span>LIVE MARKETS</span><b>Supported assets & real-time prices</b></div><small>Refreshes every 30 seconds</small></div>
      {marketError && <div className="cp-market-error">{marketError}</div>}
      <div className="cp-live-market-grid">
        {topMarkets.map((item,index)=><button type="button" key={item.id} className={`cp-live-market ${selected===item.symbol?'selected':''}`} onClick={()=>setSelected(item.symbol)}>
          <span className="cp-market-rank">{String(index+1).padStart(2,'0')}</span><img src={icon(item.symbol.toLowerCase())} alt=""/><span className="cp-market-name"><b>{item.name}</b><small>{item.symbol} · {compact.format(currency==='USD'?item.marketCapUsd:item.marketCapNgn)} mcap</small></span><span className="cp-market-price"><b>{money(item.priceUsd,item.priceNgn)}</b><em className={item.change24h<0?'down':''}>{item.change24h>=0?'+':''}{item.change24h.toFixed(2)}%</em></span>
        </button>)}
        {marketLoading && !markets.length && <div className="cp-market-loading-grid">{Array.from({length:8}).map((_,i)=><div key={i}/>)}</div>}
      </div>
    </section>

    <section className="cp-crypto-overview-grid">

      <article className="cp-crypto-glass cp-crypto-market-card">
        <div className="cp-card-heading"><span><BarChart3 size={16}/> MARKET SNAPSHOT</span><b>{markets.length || 12} ASSETS</b></div>
        {selectedMarket ? <div className="cp-selected-market"><img src={icon(selectedMarket.symbol.toLowerCase())}/><div><b>{selectedMarket.name} · {selectedMarket.symbol}</b><small>Live {currency} price</small></div><strong>{money(selectedMarket.priceUsd,selectedMarket.priceNgn)}</strong><em className={selectedMarket.change24h<0?'down':''}>{selectedMarket.change24h>=0?'+':''}{selectedMarket.change24h.toFixed(2)}%</em></div> : <div className="cp-market-loading">{marketLoading?'Loading live prices…':'Select an asset below.'}</div>}
      </article>
    </section>

    <section className="cp-crypto-detail-grid">
      <article className="cp-crypto-glass cp-detail-card"><span className="cp-kicker">ASSET DETAILS</span><h2>{selectedMarket?.name ?? selected}</h2><div className="cp-detail-price">{selectedMarket?money(selectedMarket.priceUsd,selectedMarket.priceNgn):'—'}</div><div className="cp-detail-stats"><div><span>24h change</span><b>{selectedMarket ? `${selectedMarket.change24h>=0?'+':''}${selectedMarket.change24h.toFixed(2)}%` : '—'}</b></div><div><span>24h volume</span><b>{selectedMarket?compact.format(currency==='USD'?selectedMarket.volumeUsd:selectedMarket.volumeNgn):'—'}</b></div><div><span>Market cap</span><b>{selectedMarket?compact.format(currency==='USD'?selectedMarket.marketCapUsd:selectedMarket.marketCapNgn):'—'}</b></div></div></article>
      <article className="cp-crypto-glass cp-detail-card cp-security-card"><span className="cp-kicker">CIPHERPAY WALLET</span><h2>Built around your control.</h2><div className="cp-security-lines"><span><ShieldCheck/> One CipherPay KYC</span><span><CircleDollarSign/> User-paid blockchain gas</span><span><WalletCards/> Multi-asset wallet architecture</span></div></article>
    </section>

    {panel&&<div className="cp-crypto-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setPanel(null)}><div className="cp-crypto-modal"><button className="cp-crypto-close" onClick={()=>setPanel(null)}>×</button><span className="cp-kicker">CRYPTO / {panel}</span><h2>{panel==='sell'?'Sell to NGN':panel==='swap'?'Swap crypto':panel==='send'?'Send crypto':'Receive crypto'}</h2><div className="cp-modal-asset"><img src={icon((selectedMarket?.symbol ?? selected).toLowerCase())} alt=""/><span><b>{selectedMarket?.name ?? selected}</b><small>{selectedMarket?.symbol ?? selected} · {assets.find(a=>a.symbol===(selectedMarket?.symbol??selected))?.network ?? 'Network'}</small></span></div><div className="cp-modal-field">Current market price <strong>{selectedMarket?money(selectedMarket.priceUsd,selectedMarket.priceNgn):'—'}</strong></div><button className="cp-modal-disabled">Coming soon</button></div></div>}
  </div>;
}
