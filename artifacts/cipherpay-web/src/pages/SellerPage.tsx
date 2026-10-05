import { Check, DollarSign, PackagePlus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "./page-api";
import "./seller.css";

const PLATFORMS=[
 {id:"instagram",name:"Instagram"},{id:"tiktok",name:"TikTok"},{id:"facebook",name:"Facebook"},
 {id:"discord",name:"Discord"},{id:"twitter",name:"X / Twitter"},{id:"youtube",name:"YouTube"},
 {id:"telegram",name:"Telegram"},{id:"snapchat",name:"Snapchat"},{id:"linkedin",name:"LinkedIn"}
];

export default function SellerPage(){
 const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [form,setForm]=useState({platform:"instagram",country:"",title:"",price:"",username:"",password:"",email:"",emailPassword:"",twoFactor:"",recovery:""});
 const [saving,setSaving]=useState(false);
 const load=async()=>{setLoading(true);try{setData(await apiRequest<any>("/api/seller/dashboard"));setError("")}catch(e:any){setError(e?.message||"Seller access could not be loaded.")}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const submit=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError("");setNotice("");try{await apiRequest("/api/seller/listings",{method:"POST",body:{platform:form.platform,country:form.country,title:form.title,price:Number(form.price),username:form.username,details:{username:form.username,password:form.password,email:form.email,emailPassword:form.emailPassword,twoFactor:form.twoFactor,recovery:form.recovery}}});setForm({platform:"instagram",country:"",title:"",price:"",username:"",password:"",email:"",emailPassword:"",twoFactor:"",recovery:""});setNotice("Account added to the marketplace.");await load()}catch(e:any){setError(e?.message||"Could not add the account.")}finally{setSaving(false)}};
 const remove=async(id:number)=>{try{await apiRequest("/api/seller/listings/"+id,{method:"DELETE"});await load()}catch(e:any){setError(e?.message||"Could not remove the listing.")}};
 if(loading)return <div className="seller-page"><div className="seller-empty">Loading seller dashboard…</div></div>;
 return <div className="seller-page">
  <section className="seller-hero"><div><span className="seller-kicker">CIPHERPAY / SELLER</span><h1>Sell social media accounts.</h1><p>List verified-quality inventory, reach CipherPay buyers, and receive your share automatically when an account sells.</p></div><div className="seller-fee"><DollarSign size={18}/><b>{data?.feeRate ?? 5}%</b><span>platform share per sale</span></div></section>
  {error&&<div className="seller-notice error">{error}</div>}{notice&&<div className="seller-notice success">{notice}</div>}
  <div className="seller-grid">
   <section className="seller-card"><div className="seller-card-head"><div><span className="seller-kicker">01 / LIST INVENTORY</span><h2>Add an account</h2><p>Credentials are encrypted before storage. Buyers only receive details after purchase.</p></div><PackagePlus size={20}/></div>
    <form onSubmit={submit} className="seller-form">
     <div className="seller-row"><label>Platform<select value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Country<input required value={form.country} onChange={e=>setForm({...form,country:e.target.value})} placeholder="Nigeria"/></label></div>
     <label>Listing title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Instagram aged account"/></label>
     <label>Price (₦)<input required type="number" min="1" step="0.01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} placeholder="5000"/></label>
     <div className="seller-row"><label>Username<input required value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Password<input required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} type="password"/></label></div>
     <div className="seller-row"><label>Account email<input value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Email password<input value={form.emailPassword} onChange={e=>setForm({...form,emailPassword:e.target.value})} type="password"/></label></div>
     <div className="seller-row"><label>2FA / backup code<input value={form.twoFactor} onChange={e=>setForm({...form,twoFactor:e.target.value})}/></label><label>Recovery details<input value={form.recovery} onChange={e=>setForm({...form,recovery:e.target.value})}/></label></div>
     <button className="seller-primary" disabled={saving}>{saving?"Adding…":"Publish account"} <Check size={16}/></button>
    </form>
   </section>
   <aside className="seller-side"><div className="seller-stat"><small>Available listings</small><b>{data?.stats?.available ?? 0}</b></div><div className="seller-stat"><small>Sold listings</small><b>{data?.stats?.sold ?? 0}</b></div><div className="seller-trust"><ShieldCheck size={18}/><div><b>Seller protection</b><p>Your KYC-backed seller identity is tied to every listing. CipherPay keeps {data?.feeRate ?? 5}% and credits the remainder after a completed sale.</p></div></div></aside>
  </div>
  <section className="seller-card seller-listings"><div className="seller-card-head"><div><span className="seller-kicker">02 / YOUR INVENTORY</span><h2>Listings & sales</h2></div></div>
   <div className="seller-list">{(data?.listings??[]).map((item:any)=><div className="seller-list-row" key={item.id}><div><b>{item.title}</b><span>{item.platform} · {item.country} · ₦{Number(item.price).toLocaleString("en-NG",{minimumFractionDigits:2})}</span></div><span className={"seller-status "+item.status}>{item.status}</span>{item.status==="available"&&<button type="button" onClick={()=>void remove(item.id)}><Trash2 size={15}/></button>}</div>)}{!(data?.listings??[]).length&&<div className="seller-empty">No listings yet.</div>}</div>
   <div className="seller-sales"><h3>Recent sales</h3>{(data?.sales??[]).map((sale:any)=><div className="seller-sale-row" key={sale.id}><span>{sale.platform} · {sale.country}</span><b>₦{Number(sale.sellerNet).toLocaleString("en-NG",{minimumFractionDigits:2})}</b><small>{sale.feeRate}% fee</small></div>)}{!(data?.sales??[]).length&&<div className="seller-empty">No sales yet.</div>}</div>
  </section>
 </div>
}
