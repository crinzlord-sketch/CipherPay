import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Globe2, LoaderCircle, MapPin, RefreshCw, Search, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { apiRequest } from "./page-api";
import "./SmsPoolExtrasPage.css";

type Plan = {
  id: string; name: string; countryCode: string; countryName: string;
  dataInGb: number; priceUsd: number; speed: string; extendable: number;
};

type Country = { code: string; name: string; planCount: number; minPriceUsd: number; maxDataGb: number };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function SmsPoolExtrasPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [country, setCountry] = useState<Country | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const plansRef = useRef<HTMLElement | null>(null);
  const checkoutRef = useRef<HTMLElement | null>(null);

  const loadCountries = async () => {
    setLoading(true); setError("");
    try {
      const data = await apiRequest<Country[]>("/api/sms/esim/countries");
      setCountries(data);
      if (!country) {
        const nigeria = data.find((item) => item.code === "NG");
        if (nigeria) setCountry(nigeria);
      }
    } catch (e: any) {
      setError(e?.message ?? "SMSPool eSIM catalogue is temporarily unavailable.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadCountries(); }, []);

  useEffect(() => {
    if (!country) return;
    setPlansLoading(true); setError(""); setSelected(null);
    void apiRequest<Plan[]>(`/api/sms/esim/plans?country=${encodeURIComponent(country.code)}`)
      .then(setPlans)
      .catch((e: any) => { setPlans([]); setError(e?.message ?? "Could not load eSIM plans."); })
      .finally(() => setPlansLoading(false));
  }, [country?.code]);

  const filteredCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(q));
  }, [countries, query]);

  const buy = async () => {
    if (!selected || !country || buying) return;
    setBuying(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<any>("/api/sms/esim/buy", {
        method: "POST", body: { country: country.code, plan: selected.id },
      });
      setNotice(result?.message ?? "eSIM purchased successfully. Your activation details are ready.");
    } catch (e: any) {
      setError(e?.message ?? "eSIM purchase failed. Your wallet was not charged unless the provider accepted the order.");
    } finally { setBuying(false); }
  };

  return <div className="esim-page">
    <section className="esim-hero">
      <div className="esim-hero-glow" />
      <div className="esim-hero-content">
        <div className="esim-badge"><Globe2 size={14} /> INTERNATIONAL CONNECTIVITY</div>
        <h1>Travel connected.<br /><span>Anywhere.</span></h1>
        <p>Get a data-only eSIM from the live SMSPool catalogue. Pick your destination, choose a plan, and activate without leaving CipherPay.</p>
        <div className="esim-trust-row">
          <span><ShieldCheck size={15} /> Live provider pricing</span>
          <span><Wifi size={15} /> 3G / 4G / 5G plans</span>
          <span><Smartphone size={15} /> Data-only eSIM</span>
        </div>
      </div>
      <div className="esim-hero-card">
        <div className="esim-orbit esim-orbit-one" /><div className="esim-orbit esim-orbit-two" />
        <div className="esim-phone"><div className="esim-phone-notch" /><div className="esim-phone-screen"><Globe2 size={34} /><b>Connected</b><small>International data</small></div></div>
      </div>
    </section>

    <section className="esim-workspace">
      <div className="esim-countries panel">
        <div className="esim-panel-head"><div><span className="esim-kicker">01 / DESTINATION</span><h2>Where are you going?</h2></div><button className="esim-refresh" onClick={() => void loadCountries()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></div>
        <div className="esim-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a country…" /></div>
        <div className="esim-country-list">
          {loading ? <div className="esim-empty"><LoaderCircle className="spin" /> Loading live countries…</div> :
          error && !countries.length ? <div className="esim-empty esim-error"><p>{error}</p><button onClick={() => void loadCountries()}>Try again</button></div> :
          filteredCountries.map((item) => <button className={country?.code === item.code ? "esim-country active" : "esim-country"} key={item.code} onClick={() => { setCountry(item); requestAnimationFrame(() => plansRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>
            <span className="esim-country-index">{String(filteredCountries.indexOf(item) + 1).padStart(2, "0")}</span><span className="esim-country-icon">{item.code}</span><span className="esim-country-copy"><b>{item.name}</b><small>{item.planCount} plan{item.planCount === 1 ? "" : "s"} · from {usd.format(item.minPriceUsd)}</small></span><ChevronRight size={16} />
          </button>)}
        </div>
      </div>

      <div ref={plansRef} className="esim-plans panel">
        <div className="esim-panel-head"><div><span className="esim-kicker">02 / PLAN</span><h2>{country ? `Plans for ${country.name}` : "Choose a destination"}</h2></div>{country && <span className="esim-live"><i /> LIVE</span>}</div>
        {plansLoading ? <div className="esim-empty"><LoaderCircle className="spin" /> Loading plans…</div> :
        !country ? <div className="esim-empty"><MapPin size={25} /><p>Select a country to see available plans.</p></div> :
        !plans.length ? <div className="esim-empty"><p>No eSIM plans are currently available for this destination.</p></div> :
        <div className="esim-plan-grid">{plans.map((item) => <button className={selected?.id === item.id ? "esim-plan active" : "esim-plan"} key={item.id} onClick={() => {
            setSelected(item);
            requestAnimationFrame(() => checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
          }}>
          <div className="esim-plan-top"><span>{item.speed || "Mobile data"}</span>{selected?.id === item.id && <Check size={15} />}</div>
          <strong>{item.dataInGb >= 1 ? `${item.dataInGb} GB` : `${Math.round(item.dataInGb * 1000)} MB`}</strong>
          <small>{item.name} · {item.extendable ? "Extendable" : "Single-use"}</small>
          <div className="esim-plan-bottom"><b>{usd.format(item.priceUsd)}</b><span>Choose</span></div>
        </button>)}</div>}
      </div>
    </section>

    <section ref={checkoutRef} className="esim-checkout panel">
      <div className="esim-checkout-copy"><span className="esim-kicker">03 / CHECKOUT</span><h2>{selected ? `${selected.dataInGb >= 1 ? selected.dataInGb + " GB" : Math.round(selected.dataInGb * 1000) + " MB"} · ${country?.name}` : "Your eSIM plan"}</h2><p>{selected ? `Live provider price: ${usd.format(selected.priceUsd)}. CipherPay will show the final wallet charge before purchase.` : "Choose a destination and plan above."}</p><div className="esim-selected-meta">{selected ? <><span>Selected plan</span><b>{usd.format(selected.priceUsd)}</b></> : <span>Select a plan above</span>}</div></div>
      <button className="esim-buy" disabled={!selected || buying} onClick={() => void buy()}>{buying ? <><LoaderCircle className="spin" size={17} /> Processing…</> : <>Purchase eSIM <ChevronRight size={17} /></>}</button>
    </section>

    {(notice || error) && <div className={notice ? "esim-notice" : "esim-notice error"}>{notice || error}</div>}
  </div>;
}
