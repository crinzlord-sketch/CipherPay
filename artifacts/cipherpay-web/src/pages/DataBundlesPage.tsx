import { ArrowLeft, ArrowRight, Check, LoaderCircle, Smartphone, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { apiRequest } from './page-api';
import { PageHeading } from './PagePieces';

type Provider = { provider_code: string; provider_name: string };
type Plan = { id: string; name: string; size: string; validity: string; price: number; provider: string; packageCode: string };

const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });

function formatPhone(value: string) {
  return value.replace(/[^0-9+]/g, '').slice(0, 14);
}

export default function DataBundlesPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [provider, setProvider] = useState('');
  const [phone, setPhone] = useState('');
  const [planId, setPlanId] = useState('');
  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    void apiRequest<Provider[]>('/api/data/providers')
      .then((items) => {
        if (!active) return;
        setProviders(items ?? []);
        setProvider((current) => current || items?.[0]?.provider_code || '');
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Could not load data providers.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    setPlansLoading(true);
    setError('');
    void apiRequest<Plan[]>(`/api/data/plans?provider=${encodeURIComponent(provider)}`)
      .then((items) => {
        if (!active) return;
        setPlans(items ?? []);
        setPlanId('');
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Could not load data bundles.'))
      .finally(() => active && setPlansLoading(false));
    return () => { active = false; };
  }, [provider]);

  const selected = useMemo(() => plans.find((plan) => plan.id === planId) ?? null, [plans, planId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!provider || !planId || !phone) return;
    setBuying(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiRequest<{ message?: string }>('/api/data/buy', {
        method: 'POST',
        body: { provider, packageCode: planId, phone },
      });
      setSuccess(result.message ?? 'Data bundle purchased successfully.');
      setPhone('');
      setPlanId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The data purchase could not be completed.');
    } finally {
      setBuying(false);
    }
  };

  return <>
    <PageHeading
      eyebrow="EVERYDAY / DATA"
      title="Data bundles, without Flutterwave."
      detail="Live Nigerian bundles are available in CipherPay. Your wallet is charged only for the selected bundle."
      actions={<Link href="/services" className="text-link"><ArrowLeft size={15} /> All services</Link>}
    />
    <div className="social-boost-layout">
      <section className="panel social-boost-form-panel">
        <div className="service-intro">
          <span className="social-boost-mark"><Wifi size={20} /></span>
          <div><h2>Buy a data bundle</h2><p>Choose a network, pick a live plan, enter the recipient number, and confirm.</p></div>
        </div>
        {loading ? <div className="loading-inline"><LoaderCircle size={15} className="admin-spin" /> Loading providers…</div> : <form className="service-form" onSubmit={submit}>
          <label className="field"><span>Network</span><select value={provider} onChange={(e) => setProvider(e.target.value)} required><option value="">Choose network</option>{providers.map((item) => <option key={item.provider_code} value={item.provider_code}>{item.provider_name}</option>)}</select></label>
          <label className="field"><span>Recipient phone number</span><div className="password-wrap"><Smartphone size={16} /><input type="tel" inputMode="tel" placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} required /></div></label>
          <div className="field"><span>Data bundle</span>{plansLoading ? <div className="loading-inline"><LoaderCircle size={15} className="admin-spin" /> Loading live bundles…</div> : plans.length ? <div className="plan-grid">{plans.map((plan) => <button type="button" className={`plan-card ${planId === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => setPlanId(plan.id)}><span className="plan-card-top"><b>{plan.size || plan.name}</b>{planId === plan.id && <Check size={14} />}</span><small>{plan.name}{plan.validity ? ` · ${plan.validity}` : ''}</small><strong>{money.format(plan.price)}</strong></button>)}</div> : <div className="loading-inline">No bundles are available for this network right now.</div>}</div>
          {selected && <div className="social-service-detail"><span>{selected.name}</span><small>{money.format(selected.price)}</small></div>}
          {error && <div className="error-box" role="alert">{error}</div>}
          {success && <div className="success-box" role="status"><Check size={17} /><div><b>Data purchase complete</b><span>{success}</span></div></div>}
          <button type="submit" className="btn btn-primary full-btn" disabled={buying || !provider || !planId || !phone}>{buying ? 'Processing…' : 'Buy data bundle'} <ArrowRight size={17} /></button>
        </form>}
      </section>
      <aside className="panel social-boost-side"><h3>Live data delivery.</h3><p>Choose a network and bundle, then enter the recipient number. Your wallet is charged only when you confirm the purchase.</p><div className="side-rule" /><span className="mono">DATA / LIVE</span></aside>
    </div>
  </>;
}
