import { useEffect, useState } from "react";
import { apiRequest } from "./page-api";

type Plan = any;
type Rental = any;

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function SmsPoolExtrasPage() {
  const [countries, setCountries] = useState<any[]>([]);
  const [country, setCountry] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState("");
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiRequest<any[]>("/api/sms/esim/countries").then(setCountries).catch(() => setStatus("eSIM countries are temporarily unavailable."));
    void apiRequest<any[]>("/api/sms/rentals/active").then(setRentals).catch(() => {});
  }, []);

  useEffect(() => {
    if (!country) { setPlans([]); return; }
    void apiRequest<any[]>(`/api/sms/esim/plans?country=${encodeURIComponent(country)}`)
      .then(setPlans).catch(() => setPlans([]));
  }, [country]);

  const buyEsim = async () => {
    if (!country || !plan) return;
    setBusy(true); setStatus("");
    try {
      const result = await apiRequest<any>("/api/sms/esim/buy", { method: "POST", body: { country, plan } });
      setStatus(`eSIM purchased successfully. ${result?.amount ? money.format(result.amount) : ""}`);
    } catch (e: any) { setStatus(e?.message ?? "eSIM purchase failed."); }
    finally { setBusy(false); }
  };

  return <div className="page-shell">
    <div className="page-title"><div><div className="eyebrow">SMSPOOL / INTERNATIONAL CONNECTIVITY</div><h1>International eSIM & phone rentals.</h1><p>Buy supported data-only eSIM plans or manage long-term numbers from one place.</p></div></div>
    <div className="form-layout">
      <section className="panel">
        <div className="form-section-title"><span className="step">01</span><div><h2>International eSIM</h2><p>Data-only plans. Availability comes directly from SMSPool.</p></div></div>
        <label className="field"><span>Country</span><select value={country} onChange={e => setCountry(e.target.value)}><option value="">Choose country</option>{countries.map((c:any)=><option key={String(c.id ?? c.country_id ?? c.code)} value={String(c.id ?? c.country_id ?? c.code)}>{c.name ?? c.title ?? c.country_name}</option>)}</select></label>
        <label className="field"><span>Plan</span><select value={plan} onChange={e => setPlan(e.target.value)} disabled={!plans.length}><option value="">Choose plan</option>{plans.map((p:any)=><option key={String(p.id ?? p.plan_id ?? p.plan)} value={String(p.id ?? p.plan_id ?? p.plan)}>{p.name ?? p.plan_name ?? p.data ?? "Data plan"} {p.price ? `— ${p.price}` : ""}</option>)}</select></label>
        <button className="full-btn" type="button" disabled={!plan || busy} onClick={() => void buyEsim()}>{busy ? "Purchasing…" : "Purchase eSIM"}</button>
      </section>
      <section className="panel">
        <div className="form-section-title"><span className="step">02</span><div><h2>Long-term numbers</h2><p>Manage active SMSPool rentals and incoming messages.</p></div></div>
        {!rentals.length ? <p className="muted-line">No active rentals.</p> : rentals.map((r:any, i:number) => <div className="recipient-preview" key={String(r.rental_code ?? r.code ?? i)}><div><b>{r.number ?? r.phonenumber ?? "Rental number"}</b><small>{r.country ?? r.service ?? "SMSPool rental"}</small></div><span className="recipient-verified">Active</span></div>)}
      </section>
    </div>
    {status && <div className="success-box">{status}</div>}
  </div>;
}
