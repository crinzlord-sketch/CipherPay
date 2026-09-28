import { ArrowLeft, ArrowRight, Bolt, Check, ChevronRight, CreditCard, Globe2, Lightbulb, Loader2, Receipt, ShieldCheck, Tv, Wifi, Target, Smartphone } from 'lucide-react';
import { useLocation } from 'wouter';
import { useState } from 'react';
import {
  useListBillCategories,
  useListBillProviders,
  usePayBill,
  useValidateBill,
} from '@workspace/api-client-react';
import './bills-page.css';

function money(value: unknown) {
  return `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function iconFor(id: string) {
  if (id === 'electricity') return <Bolt size={22} />;
  if (id === 'cable') return <Tv size={22} />;
  if (id === 'internet') return <Wifi size={22} />;
  if (id === 'betting') return <Target size={22} />;
  if (id === 'airtime') return <Smartphone size={22} />;
  return <Receipt size={22} />;
}
function ProviderLogo({ logo, name }: { logo?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <span className="bill-provider-logo">{logo && !broken ? <img src={logo} alt="" onError={() => setBroken(true)} /> : <span>{initials || 'CP'}</span>}</span>;
}
function clean(value: string) { return value.replace(/,/g, ''); }

export default function BillsPage() {
  const [location, setLocation] = useLocation();
  const parts = location.split('?')[0].split('/').filter(Boolean);
  const category = parts[1] ?? '';
  const providerCode = parts[2] ? decodeURIComponent(parts[2]) : '';
  const cats = useListBillCategories();
  const providers = useListBillProviders(
    { category },
    { query: { enabled: !!category, staleTime: 60_000 } } as any,
  );
  const validate = useValidateBill();
  const pay = usePayBill();
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [validation, setValidation] = useState<any>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<any>(null);

  const categories: any[] = cats.data ?? [];
  const providerList: any[] = providers.data ?? [];
  const selectedCategory = categories.find((item) => item.id === category);
  const selectedProvider = providerList.find((item) => (item.code || item.id) === providerCode);

  const goBack = () => {
    if (providerCode) setLocation(`/bills/${encodeURIComponent(category)}`);
    else if (category) setLocation('/bills');
    else setLocation('/');
  };

  const verify = () => {
    setError('');
    setValidation(null);
    validate.mutate(
      { data: { provider: providerCode, customerId, ...(category === 'electricity' ? { type: meterType } : {}) } as any },
      {
        onSuccess: (result: any) => setValidation(result),
        onError: (reason: any) => setError(reason?.message ?? 'We could not verify those details.'),
      },
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!validation) { setError('Verify the customer details before paying.'); return; }
    const numericAmount = Number(clean(amount));
    if (!(numericAmount > 0)) { setError('Enter a valid amount.'); return; }
    pay.mutate(
      { data: { provider: providerCode, customerId, amount: numericAmount, customerName: validation.name, phone: phone || customerId, meterType } as any },
      {
        onSuccess: (result: any) => setSuccess(result),
        onError: (reason: any) => setError(reason?.message ?? 'Bill payment failed.'),
      },
    );
  };

  if (!category) {
    return <main className="bills-page">
      <section className="bills-hero">
        <div className="bills-hero-grid" />
        <div className="bills-hero-copy">
          <span className="bills-eyebrow"><span /> CIPHERPAY / BILL DESK</span>
          <h1>Everything you need.<br /><em>One clean flow.</em></h1>
          <p>Pick what you need to pay. Choose the provider. We’ll handle the rest.</p>
        </div>
        <div className="bills-hero-orbit"><span /><span /><span /></div>
        <div className="bills-hero-foot"><span><ShieldCheck size={14} /> Secure wallet payment</span><span><Check size={14} /> Live provider catalogue</span><span><Receipt size={14} /> Instant receipt</span></div>
      </section>

      <section className="bills-section-head">
        <div><span className="bills-kicker">01 / CHOOSE A BILL</span><h2>What are you paying for?</h2><p>No crowded form. Start with one clear choice.</p></div>
        <span className="bills-count">{categories.length || '—'} services</span>
      </section>

      {cats.isLoading ? <div className="bills-loading"><Loader2 className="spin" size={22} /> Loading live services…</div> :
        <div className="bills-category-grid">
          {categories.map((item: any, index) => <button type="button" className="bills-category-card" key={item.id} onClick={() => setLocation(`/bills/${encodeURIComponent(item.id)}`)} style={{ ['--delay' as any]: `${index * 45}ms` }}>
            <span className="bills-card-index">0{index + 1}</span>
            <span className="bills-category-icon">{iconFor(item.id)}</span>
            <span className="bills-category-content"><b>{item.name}</b><small>{item.description || 'Pay this service from your CipherPay wallet.'}</small></span>
            <span className="bills-card-arrow"><ArrowRight size={18} /></span>
          </button>)}
        </div>}

      <div className="bills-bottom-note"><Lightbulb size={17} /><span><b>Built to stay out of your way.</b> We load the provider catalogue live so the choices on screen reflect what is actually available.</span></div>
    </main>;
  }

  if (!providerCode) {
    return <main className="bills-page bills-provider-page">
      <div className="bills-topline"><button className="bills-back" type="button" onClick={goBack}><ArrowLeft size={16} /> All bills</button><span>02 / PROVIDER</span></div>
      <section className="bills-provider-hero">
        <div><span className="bills-eyebrow"><span /> {selectedCategory?.name ?? 'BILL'} / PROVIDERS</span><h1>Choose your provider.</h1><p>Tap the provider you want. The payment details come next — no giant dropdowns.</p></div>
        <div className="bills-stepper"><span className="done">01</span><i /><span className="active">02</span><i /><span>03</span></div>
      </section>
      <section className="bills-section-head compact"><div><span className="bills-kicker">LIVE CATALOGUE</span><h2>{selectedCategory?.name ?? 'Bill'} providers</h2></div><span className="bills-count">{providerList.length || '—'} available</span></section>
      {providers.isLoading ? <div className="bills-loading"><Loader2 className="spin" size={22} /> Loading live providers…</div> :
       providers.isError ? <div className="bills-error"><b>Providers are unavailable right now.</b><span>Refresh and try again.</span></div> :
       <div className="bills-provider-grid">{providerList.map((item: any, index) => { const code = item.code || item.id; return <button type="button" className="bills-provider-card" key={item.id ?? code} onClick={() => setLocation(`/bills/${encodeURIComponent(category)}/${encodeURIComponent(code)}`)} style={{ ['--delay' as any]: `${index * 35}ms` }}>
          <ProviderLogo logo={item.logo} name={item.name} />
          <span className="bills-provider-copy"><b>{item.name}</b><small>{item.description || 'Live provider'}</small>{item.minimumAmount && <small>From {money(item.minimumAmount)}</small>}</span>
          <ChevronRight size={18} />
        </button>; })}</div>}
      <div className="bills-bottom-note"><ShieldCheck size={17} /><span><b>Provider logos stay live.</b> If a provider supplies a logo, CipherPay renders it directly from the live catalogue and falls back gracefully if the image is unavailable.</span></div>
    </main>;
  }

  if (providers.isLoading && !selectedProvider) {
    return <main className="bills-page"><div className="bills-loading"><Loader2 className="spin" size={22} /> Loading provider…</div></main>;
  }

  return <main className="bills-page bills-payment-page">
    <div className="bills-topline"><button className="bills-back" type="button" onClick={goBack}><ArrowLeft size={16} /> Providers</button><span>03 / PAYMENT</span></div>
    <div className="bills-payment-layout">
      <section className="bills-payment-main">
        <div className="bills-selected-provider">
          <ProviderLogo logo={selectedProvider?.logo} name={selectedProvider?.name ?? providerCode} />
          <div><span>{selectedCategory?.name ?? 'Bill'}</span><strong>{selectedProvider?.name ?? providerCode}</strong></div>
          <span className="bills-live"><i /> LIVE</span>
        </div>

        <div className="bills-form-card">
          <div className="bills-form-head"><div><span className="bills-kicker">ACCOUNT DETAILS</span><h2>Who are we paying?</h2><p>Verify the account before any wallet debit happens.</p></div><span className="bills-secure"><ShieldCheck size={14} /> Verified first</span></div>

          {category === 'electricity' && <div className="bills-toggle"><button type="button" className={meterType === 'prepaid' ? 'active' : ''} onClick={() => { setMeterType('prepaid'); setValidation(null); }}>Prepaid</button><button type="button" className={meterType === 'postpaid' ? 'active' : ''} onClick={() => { setMeterType('postpaid'); setValidation(null); }}>Postpaid</button></div>}

          <label className="bills-field"><span>{category === 'electricity' ? 'Meter number' : 'Customer / account number'}</span><input value={customerId} onChange={(e) => { setCustomerId(e.target.value); setValidation(null); setError(''); }} placeholder={category === 'electricity' ? 'Enter meter number' : 'Enter customer or smartcard number'} /></label>
          <label className="bills-field"><span>Phone for receipt <small>optional</small></span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" /></label>

          <div className="bills-verify">
            <div>{validation ? <><span className="bills-check"><Check size={15} /></span><div><b>{validation.name}</b><small>{validation.address || 'Customer details verified by provider'}</small></div></> : <><span className="bills-check muted"><ShieldCheck size={15} /></span><div><b>Not verified yet</b><small>We’ll confirm the account directly with the provider.</small></div></>}</div>
            <button type="button" onClick={verify} disabled={validate.isPending || !customerId}>{validate.isPending ? <><Loader2 className="spin" size={15} /> Checking</> : 'Verify account'}</button>
          </div>

          <label className="bills-field"><span>Amount</span><div className="bills-amount-wrap"><b>₦</b><input inputMode="numeric" value={amount} onChange={(e) => setAmount(Number(clean(e.target.value).replace(/\D/g, '') || 0).toLocaleString('en-NG'))} placeholder={selectedProvider?.minimumAmount ? `From ${money(selectedProvider.minimumAmount)}` : '0'} /></div></label>
          {selectedProvider?.minimumAmount && <div className="bills-limit">Provider range <b>{money(selectedProvider.minimumAmount)} — {selectedProvider.maximumAmount ? money(selectedProvider.maximumAmount) : 'No stated maximum'}</b></div>}

          {error && <div className="bills-error"><b>Payment needs attention</b><span>{error}</span></div>}
          <button type="button" className="bills-pay-button" disabled={pay.isPending || !validation || !amount} onClick={submit}>{pay.isPending ? <><Loader2 className="spin" size={17} /> Processing payment…</> : <>Pay {amount ? `₦${clean(amount)}` : 'bill'} <ArrowRight size={17} /></>}</button>
        </div>
      </section>

      <aside className="bills-summary">
        <div className="bills-summary-card">
          <span className="bills-kicker">ORDER PREVIEW</span>
          <div className="bills-summary-provider"><ProviderLogo logo={selectedProvider?.logo} name={selectedProvider?.name ?? providerCode} /><div><b>{selectedProvider?.name ?? providerCode}</b><small>{selectedCategory?.name ?? 'Bill payment'}</small></div></div>
          <div className="bills-summary-lines"><div><span>Customer</span><b>{validation?.name || 'Awaiting verification'}</b></div><div><span>Account</span><b>{customerId || '—'}</b></div><div><span>Amount</span><b>{amount ? `₦${clean(amount)}` : '—'}</b></div></div>
          <div className="bills-summary-total"><span>Wallet debit</span><strong>{amount ? `₦${clean(amount)}` : '—'}</strong></div>
        </div>
        <div className="bills-trust"><ShieldCheck size={18} /><div><b>Verify before debit</b><p>CipherPay checks the recipient first so you can catch a wrong account before payment.</p></div></div>
      </aside>
    </div>

    {success && <div className="bills-success-backdrop"><section className="bills-success"><span className="bills-success-icon"><Check size={28} /></span><span className="bills-kicker">PAYMENT COMPLETE</span><h2>Bill paid.</h2><p>Your payment was accepted and the transaction has been recorded.</p><div><button type="button" onClick={() => setLocation('/transactions')}>View transaction <ArrowRight size={16} /></button><button type="button" className="ghost" onClick={() => { setSuccess(null); setCustomerId(''); setAmount(''); setValidation(null); }}>Pay another</button></div></section></div>}
  </main>;
}
