import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BarChart3, Copy, Check, RefreshCw, X, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';
import { apiUrl } from './page-api';
import './crypto.css';

type Market = { id:string; symbol:string; name:string; image:string; priceNgn:number; priceUsd:number; change24h:number; marketCapNgn:number; marketCapUsd:number; volumeNgn:number; volumeUsd:number };
type CryptoBalance = { network:string; asset:string; balance:number; address:string; type:string; tokenAddress?:string };
type CryptoTx = { id:number; network:string; asset:string; direction:string; amount:string; to_address?:string; tx_hash:string; status:string; created_at:string };

const icon=(code:string)=>`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons/svg/color/${code}.svg`;
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const ngn=new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2});
const compact=new Intl.NumberFormat('en-NG',{notation:'compact',maximumFractionDigits:1});

export default function CryptoPage(){
  const [markets,setMarkets]=useState<Market[]>([]);
  const [balances,setBalances]=useState<CryptoBalance[]>([]);
  const [walletAddress,setWalletAddress]=useState('');
  const [transactions,setTransactions]=useState<CryptoTx[]>([]);
  const [selected,setSelected]=useState('BTC');
  const [marketLoading,setMarketLoading]=useState(true);
  const [walletLoading,setWalletLoading]=useState(true);
  const [marketError,setMarketError]=useState('');
  const [walletError,setWalletError]=useState('');
  const [panel,setPanel]=useState<'send'|'receive'|'swap'|'sell'|null>(null);
  const [currency,setCurrency]=useState<'USD'|'NGN'>('USD');
  const [network,setNetwork]=useState('ethereum');
  const [sendTo,setSendTo]=useState('');
  const [sendAmount,setSendAmount]=useState('');
  const [sendPin,setSendPin]=useState('');
  const [sending,setSending]=useState(false);
  const [sendError,setSendError]=useState('');
  const [sendSuccess,setSendSuccess]=useState('');
  const [copied,setCopied]=useState(false);

  const token=()=>window.localStorage.getItem('cipherpay_token');
  const authHeaders=()=>{const t=token(); return t?{Authorization:`Bearer ${t}`}:{};};

  const loadWallet=async()=>{
    try{
      setWalletError('');
      const response=await fetch(apiUrl('/api/crypto/wallet'),{headers:authHeaders(),cache:'no-store'});
      const body=await response.json();
      if(!response.ok) throw new Error(body?.error||'Crypto wallet unavailable');
      setWalletAddress(body.address||''); setBalances(Array.isArray(body.balances)?body.balances:[]);
    }catch(error:any){setWalletError(error?.message||'Crypto wallet unavailable.');}
    finally{setWalletLoading(false);}
  };
  const loadTransactions=async()=>{
    try{
      const response=await fetch(apiUrl('/api/crypto/transactions'),{headers:authHeaders(),cache:'no-store'});
      if(response.ok){const body=await response.json();setTransactions(Array.isArray(body.transactions)?body.transactions:[]);}
    }catch{}
  };

  useEffect(()=>{void loadWallet();void loadTransactions();},[]);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        setMarketError('');
        const response=await fetch(apiUrl('/api/crypto/markets'),{headers:authHeaders(),cache:'no-store'});
        if(!response.ok) throw new Error('Market data unavailable');
        const body=await response.json();
        if(active)setMarkets(Array.isArray(body?.data)?body.data:[]);
      }catch(error:any){if(active)setMarketError(error?.message??'Live prices are temporarily unavailable.');}
      finally{if(active)setMarketLoading(false);}
    };
    void load(); const timer=window.setInterval(load,30000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);

  const selectedMarket=markets.find(item=>item.symbol===selected);
  const ngnPerUsd=selectedMarket?.priceUsd ? selectedMarket.priceNgn/selectedMarket.priceUsd : 0;
  const money=(u:number,n:number)=>currency==='USD'?usd.format(u):ngn.format(n);
  const topMarkets=useMemo(()=>markets.slice(0,12),[markets]);

  const balanceValueUsd=balances.reduce((sum,item)=>{
    const market=markets.find(m=>m.symbol===item.asset);
    return sum+(market?.priceUsd||0)*item.balance;
  },0);
  const balanceValueNgn=balanceValueUsd*(ngnPerUsd||0);
  const supportedForNetwork=(asset:string,net:string)=>{
    if(asset==='ETH')return net==='ethereum'||net==='base';
    if(asset==='BNB')return net==='bsc';
    if(asset==='USDC')return ['ethereum','base','bsc'].includes(net);
    if(asset==='USDT')return ['ethereum','bsc'].includes(net);
    return false;
  };
  const sendableAssets=Array.from(new Set(balances.filter(b=>supportedForNetwork(b.asset,network)).map(b=>b.asset)));
  const [sendAsset,setSendAsset]=useState('ETH');

  useEffect(()=>{if(sendableAssets.length&&!sendableAssets.includes(sendAsset))setSendAsset(sendableAssets[0]);},[network,balances]);
  useEffect(()=>{if(selected==='BTC'&&!markets.find(m=>m.symbol==='BTC'))setSelected(markets[0]?.symbol||'BTC');},[markets]);

  const openPanel=(next:'send'|'receive'|'swap'|'sell')=>{
    setSendError('');setSendSuccess('');setPanel(next);
    if(next==='send' && !sendableAssets.includes(sendAsset) && sendableAssets[0])setSendAsset(sendableAssets[0]);
  };
  const closePanel=()=>setPanel(null);

  const submitSend=async()=>{
    setSending(true);setSendError('');setSendSuccess('');
    try{
      const response=await fetch(apiUrl('/api/crypto/send'),{
        method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},
        body:JSON.stringify({network,asset:sendAsset,to:sendTo,amount:Number(sendAmount),pin:sendPin}),
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error||'Transaction failed');
      setSendSuccess(body.txHash||'Transaction submitted');
      setSendTo('');setSendAmount('');setSendPin('');
      await loadWallet();await loadTransactions();
    }catch(error:any){setSendError(error?.message||'Transaction failed.');}
    finally{setSending(false);}
  };

  const copyAddress=async()=>{
    if(!walletAddress)return;
    await navigator.clipboard.writeText(walletAddress);setCopied(true);window.setTimeout(()=>setCopied(false),1600);
  };

  return <div className="cp-crypto-page">
    <div className="cp-crypto-top"><Link href="/" className="cp-crypto-back"><ArrowLeft size={15}/> Back</Link><span className="cp-crypto-live"><i/> Live market data</span></div>

    <section className="cp-crypto-dashboard">
      <div className="cp-crypto-dashboard-copy">
        <div className="cp-crypto-balance-hero">
          <div><span>YOUR CRYPTO BALANCE</span><strong>{currency==='USD'?usd.format(balanceValueUsd):ngn.format(balanceValueNgn)}</strong><small>{balances.filter(b=>b.balance>0).length} assets held · Blockchain wallet active</small></div>
          <button type="button" className="cp-currency-switch" onClick={()=>setCurrency(currency==='USD'?'NGN':'USD')}><b>{currency}</b><span>⇄</span><em>{currency==='USD'?'NGN':'USD'}</em></button>
        </div>
        <span className="cp-kicker">CIPHERPAY / CRYPTO WALLET</span>
        <div className="cp-crypto-actions"><span className="cp-actions-label">WALLET ACTIONS</span>
          <button onClick={()=>openPanel('receive')}><ArrowDownLeft/>Receive</button>
          <button onClick={()=>openPanel('send')}><ArrowUpRight/>Send</button>
          <button onClick={()=>openPanel('swap')}><RefreshCw/>Swap</button>
          <button onClick={()=>openPanel('sell')}><b>₦</b>Sell to NGN</button>
        </div>
      </div>
    </section>

    {walletError&&<div className="cp-market-error">{walletError}</div>}

    <section className="cp-crypto-market-section">
      <div className="cp-crypto-section-title"><div><span>YOUR ASSETS</span><b>On-chain balances</b></div><small>Live blockchain balances</small></div>
      <div className="cp-live-market-grid">
        {balances.filter(item=>item.balance>0).map((item,index)=><button type="button" key={item.network+item.asset} className={`cp-live-market ${selected===item.asset?'selected':''}`} onClick={()=>setSelected(item.asset)}>
          <span className="cp-market-rank">{String(index+1).padStart(2,'0')}</span><img src={icon(item.asset.toLowerCase())} alt=""/><span className="cp-market-name"><b>{item.asset}</b><small>{item.network} · {item.balance}</small></span><span className="cp-market-price"><b>{money((markets.find(m=>m.symbol===item.asset)?.priceUsd||0)*item.balance,(markets.find(m=>m.symbol===item.asset)?.priceNgn||0)*item.balance)}</b></span>
        </button>)}
        {!balances.filter(item=>item.balance>0).length&&!walletLoading&&<div className="cp-market-loading">No crypto held yet. Tap Receive to get your wallet address.</div>}
        {walletLoading&&<div className="cp-market-loading"><Loader2 className="animate-spin" size={18}/> Preparing your blockchain wallet…</div>}
      </div>
    </section>

    <section className="cp-crypto-market-section">
      <div className="cp-crypto-section-title"><div><span>LIVE MARKETS</span><b>Supported assets & real-time prices</b></div><small>Refreshes every 30 seconds</small></div>
      {marketError&&<div className="cp-market-error">{marketError}</div>}
      <div className="cp-live-market-grid">
        {topMarkets.map((item,index)=><button type="button" key={item.id} className={`cp-live-market ${selected===item.symbol?'selected':''}`} onClick={()=>setSelected(item.symbol)}>
          <span className="cp-market-rank">{String(index+1).padStart(2,'0')}</span><img src={icon(item.symbol.toLowerCase())} alt=""/><span className="cp-market-name"><b>{item.name}</b><small>{item.symbol} · {compact.format(currency==='USD'?item.marketCapUsd:item.marketCapNgn)} mcap</small></span><span className="cp-market-price"><b>{money(item.priceUsd,item.priceNgn)}</b><em className={item.change24h<0?'down':''}>{item.change24h>=0?'+':''}{item.change24h.toFixed(2)}%</em></span>
        </button>)}
        {marketLoading&&!markets.length&&<div className="cp-market-loading">Loading live prices…</div>}
      </div>
    </section>

    <section className="cp-crypto-overview-grid">
      <article className="cp-crypto-glass cp-crypto-market-card">
        <div className="cp-card-heading"><span><BarChart3 size={16}/> MARKET SNAPSHOT</span><b>{markets.length||12} ASSETS</b></div>
        {selectedMarket?<div className="cp-selected-market"><img src={icon(selectedMarket.symbol.toLowerCase())}/><div><b>{selectedMarket.name} · {selectedMarket.symbol}</b><small>Live {currency} price</small></div><strong>{money(selectedMarket.priceUsd,selectedMarket.priceNgn)}</strong><em className={selectedMarket.change24h<0?'down':''}>{selectedMarket.change24h>=0?'+':''}{selectedMarket.change24h.toFixed(2)}%</em></div>:<div className="cp-market-loading">Select an asset below.</div>}
      </article>
    </section>

    <section className="cp-crypto-detail-grid">
      <article className="cp-crypto-glass cp-detail-card"><span className="cp-kicker">RECENT ON-CHAIN ACTIVITY</span><h2>{transactions.length?'Your crypto transactions':'Ready for your first transaction'}</h2>
        {transactions.length?<div className="cp-crypto-tx-list">{transactions.map(tx=><a key={tx.id} href={`https://${tx.network==='base'?'basescan.org':tx.network==='bsc'?'bscscan.com':'etherscan.io'}/tx/${tx.tx_hash}`} target="_blank" rel="noreferrer"><span><b>{tx.direction==='outgoing'?'Sent':'Received'} {tx.amount} {tx.asset}</b><small>{tx.network} · {new Date(tx.created_at).toLocaleString()}</small></span><ExternalLink size={15}/></a>)}</div>:<p>Your blockchain activity will appear here after you send or receive crypto.</p>}
      </article>
    </section>

    {panel&&typeof document!=='undefined'&&createPortal(<div className="cp-crypto-modal-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&closePanel()}>
      <div className="cp-crypto-modal" role="dialog" aria-modal="true">
        <button type="button" className="cp-crypto-close" onClick={closePanel} aria-label="Close"><X size={18}/></button>
        <span className="cp-kicker">CRYPTO / {panel}</span>
        <h2>{panel==='sell'?'Sell to NGN':panel==='swap'?'Swap crypto':panel==='send'?'Send crypto':'Receive crypto'}</h2>

        {panel==='receive'&&<div className="cp-crypto-receive">
          <div className="cp-modal-asset"><span><b>Your CipherPay blockchain address</b><small>Use this address for supported EVM networks.</small></span></div>
          <div className="cp-receive-address"><code>{walletAddress||'Preparing wallet…'}</code><button onClick={copyAddress}>{copied?<Check size={17}/>:<Copy size={17}/>}</button></div>
          <div className="cp-receive-networks"><b>Supported now</b><span>Ethereum · Base · BNB Smart Chain</span><small>Only send an asset on its matching network.</small></div>
          <button type="button" className="cp-modal-disabled" disabled={!walletAddress}>Address ready</button>
        </div>}

        {panel==='send'&&<div>
          <label className="cp-modal-field">Network<select value={network} onChange={e=>setNetwork(e.target.value)}><option value="ethereum">Ethereum</option><option value="base">Base</option><option value="bsc">BNB Smart Chain</option></select></label>
          <label className="cp-modal-field">Asset<select value={sendAsset} onChange={e=>setSendAsset(e.target.value)}>{sendableAssets.map(a=><option key={a}>{a}</option>)}</select></label>
          <label className="cp-modal-field">Destination address<input value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder="0x…" autoCapitalize="none"/></label>
          <label className="cp-modal-field">Amount<input value={sendAmount} onChange={e=>setSendAmount(e.target.value)} inputMode="decimal" placeholder="0.00"/></label>
          <label className="cp-modal-field">Transfer PIN<input value={sendPin} onChange={e=>setSendPin(e.target.value.replace(/\D/g,'').slice(0,4))} inputMode="numeric" type="password" placeholder="4 digits"/></label>
          {sendError&&<div className="cp-market-error">{sendError}</div>}{sendSuccess&&<div className="cp-receive-networks"><b>Transaction submitted</b><small>{sendSuccess}</small></div>}
          <button type="button" className="cp-modal-disabled" onClick={()=>void submitSend()} disabled={sending||!sendableAssets.length}>{sending?<><Loader2 size={16} className="animate-spin"/> Sending…</>:<>Send {sendAsset}</>}</button>
        </div>}

        {(panel==='swap'||panel==='sell')&&<div><div className="cp-receive-networks"><b>Coming next</b><small>The on-chain wallet is live first. Swap and NGN conversion stay separate until the compliant exchange/on-ramp layer is connected.</small></div><button type="button" className="cp-modal-disabled" onClick={closePanel}>Close</button></div>}
      </div>
    </div>,document.body)}
  </div>;
}
