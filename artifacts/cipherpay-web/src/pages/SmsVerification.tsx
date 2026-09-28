import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  cancelSmsActivation,
  checkSmsCode,
  useBuySmsNumber,
  useListSmsCountries,
  useListSmsHistory,
  useListSmsServices,
} from '@workspace/api-client-react';
import { AlertCircle, Check, ChevronDown, Clock3, Copy, LoaderCircle, MessageSquareText, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';

type Country = { code: string; name: string; flag?: string };
type Service = { id: string; name: string; price: number; country: string };
type Activation = {
  activationId: string;
  number: string;
  service: string;
  country: string;
  amount: number;
  status: string;
  code?: string | null;
  createdAt?: string;
};
type CodeResult = { activationId: string; status: string; code?: string | null; fullSms?: string | null };

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const SMS_CANCEL_AFTER_MS = 15 * 60_000;

const serviceAliases: Record<string, string[]> = {
  whatsapp: ['wa'],
  facebook: ['fb', 'meta'],
  instagram: ['ig'],
  telegram: ['tg'],
  twitter: ['x'],
  microsoft: ['ms'],
  gmail: ['google mail'],
};

function normalizeSearch(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
}

function searchableServiceText(service: Service) {
  const name = normalizeSearch(service.name);
  const aliases = Object.entries(serviceAliases)
    .filter(([key]) => name.includes(key))
    .flatMap(([, values]) => values)
    .join(' ');
  return `${name} ${normalizeSearch(service.id)} ${aliases}`.trim();
}

function serviceMatchScore(service: Service, query: string) {
  const name = normalizeSearch(service.name);
  const searchable = searchableServiceText(service);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(' ').some((word) => word.startsWith(query))) return 2;
  if (searchable.includes(` ${query}`) || searchable.startsWith(query)) return 3;
  return 4;
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function SmsVerification() {
  const queryClient = useQueryClient();
  const countriesQuery = useListSmsCountries({ query: { queryKey: ['/api/sms/countries'], staleTime: 5 * 60_000 } } as any);
  const [country, setCountry] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const servicesQuery = useListSmsServices(
    { country },
    { query: { enabled: Boolean(country), queryKey: ['/api/sms/services', country], staleTime: 30_000 } } as any,
  );
  const historyQuery = useListSmsHistory({ query: { queryKey: ['/api/sms/history'], staleTime: 0 } } as any);
  const buyNumber = useBuySmsNumber();
  const countries = (countriesQuery.data ?? []) as Country[];
  const services = (servicesQuery.data ?? []) as Service[];
  const history = (historyQuery.data ?? []) as Activation[];
  const [service, setService] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceOpen, setServiceOpen] = useState(false);
  const [active, setActive] = useState<Activation | null>(null);
  const [liveCode, setLiveCode] = useState<CodeResult | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!country && countries.length) {
      const nigeria = countries.find((item) => item.name.toLowerCase() === 'nigeria');
      setCountry(nigeria?.code ?? countries[0].code);
    }
  }, [countries, country]);

  useEffect(() => {
    if (service && !services.some((item) => item.id === service)) setService('');
  }, [service, services]);

  const countryQuery = normalizeSearch(countrySearch);
  const countryMatches = countries.filter((item) =>
    normalizeSearch(`${item.name} ${item.code}`).includes(countryQuery),
  );
  const serviceQuery = normalizeSearch(serviceSearch);
  const serviceMatches = serviceQuery
    ? services
      .filter((item) => searchableServiceText(item).includes(serviceQuery))
      .sort((a, b) => serviceMatchScore(a, serviceQuery) - serviceMatchScore(b, serviceQuery))
    : services;

  useEffect(() => {
    if (!active && history.length) {
      const pending = history.find((item) => item.status === 'pending');
      if (pending) setActive(pending);
    }
  }, [active, history]);

  const selectedCountry = countries.find((item) => item.code === country);
  const selectedService = services.find((item) => item.id === service);

  const chooseCountry = (item: Country) => {
    setCountry(item.code);
    setCountrySearch(item.name);
    setCountryOpen(false);
    setService('');
    setServiceSearch('');
    setServiceOpen(false);
  };

  const chooseService = (item: Service) => {
    setService(item.id);
    setServiceSearch(item.name);
    setServiceOpen(false);
  };

  const refreshCode = useCallback(async (activationId: string) => {
    setChecking(true);
    try {
      const result = await checkSmsCode(activationId);
      setLiveCode(result as CodeResult);
      if (result.status !== 'pending') {
        await queryClient.invalidateQueries();
        setActive((current) => current?.activationId === activationId ? { ...current, code: result.code ?? null, status: result.status } : current);
      }
      setError('');
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not refresh the SMS status.');
    } finally {
      setChecking(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!active?.activationId || active.status !== 'pending') return;
    const timer = window.setInterval(() => { void refreshCode(active.activationId); }, 8_000);
    return () => window.clearInterval(timer);
  }, [active?.activationId, active?.status, refreshCode]);

  useEffect(() => {
    if (!active?.createdAt || active.status !== 'pending') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active?.createdAt, active?.status]);

  const cancelEligibleAt = active?.createdAt
    ? new Date(active.createdAt).getTime() + SMS_CANCEL_AFTER_MS
    : null;
  const cancelRemaining = cancelEligibleAt == null ? null : Math.max(0, cancelEligibleAt - now);
  const canCancel = active?.status === 'pending' && !active.code && cancelRemaining === 0;

  const cancelActivation = async () => {
    if (!active || !canCancel || cancelling) return;
    setCancelling(true);
    setError('');
    setSuccess('');
    try {
      const result = await cancelSmsActivation(active.activationId);
      setActive((current) => current?.activationId === active.activationId ? null : current);
      setLiveCode({ activationId: result.activationId, status: result.status });
      setSuccess(`${naira.format(result.amount)} has been returned to your wallet.`);
      await queryClient.invalidateQueries();
    } catch (reason: any) {
      setError(reason?.message ?? 'Could not cancel this number or confirm the refund.');
    } finally {
      setCancelling(false);
    }
  };

  const buy = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLiveCode(null);
    buyNumber.mutate(
      { data: { country, service } },
      {
        onSuccess: async (result: any) => {
          const chosen = services.find((item) => item.id === service);
          setActive({
            activationId: result.activationId,
            number: result.number,
            service: chosen?.name ?? service,
            country: countries.find((item) => item.code === country)?.name ?? country,
            amount: chosen?.price ?? 0,
            status: result.status ?? 'pending',
            createdAt: result.createdAt ?? new Date().toISOString(),
          });
          await queryClient.invalidateQueries();
        },
        onError: (reason: any) => setError(reason?.message ?? 'Could not purchase a number.'),
      },
    );
  };

  const copyNumber = async () => {
    if (!active?.number) return;
    try {
      await navigator.clipboard.writeText(active.number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  };

  const serviceStatus = servicesQuery.isLoading
    ? 'Loading services and current prices…'
    : servicesQuery.isError
      ? 'Could not load services. Try again in a moment.'
      : services.length
        ? `${services.length} services available`
        : 'No services are available in this country right now.';

  return (
    <>
      <div className="page-title">
        <div><div className="eyebrow">TOOLS / SMS VERIFICATION</div><h1>Receive a verification code.</h1><p>Rent a number for a service and watch for its incoming SMS.</p></div>
      </div>
      <div className="sms-layout">
        <form className="panel sms-order-panel" onSubmit={buy}>
          <div className="form-section-title"><span className="step">01</span><div><h2>Choose a country</h2><p>Availability and prices update from SMSPool.</p></div></div>
          <label className="field"><span>Country</span>
            <div className={`sms-picker ${countryOpen ? 'is-open' : ''}`}>
              <div className="sms-search-input sms-picker-input">
              <Search size={16} aria-hidden="true" />
              <input
                value={countrySearch}
                onChange={(event) => { setCountrySearch(event.target.value); setCountryOpen(true); }}
                onFocus={() => {
                  setCountryOpen(true);
                  if (selectedCountry && countrySearch === selectedCountry.name) setCountrySearch('');
                }}
                placeholder={selectedCountry?.name ?? 'Search country'}
                aria-label="Search countries"
                aria-expanded={countryOpen}
                aria-controls="sms-country-options"
                role="combobox"
                data-testid="input-sms-country-search"
              />
              {countrySearch ? <button type="button" className="sms-picker-clear" onClick={() => setCountrySearch('')} aria-label="Clear country search"><X size={15} /></button> : null}
              <button type="button" className="sms-picker-toggle" onClick={() => setCountryOpen((open) => !open)} aria-label="Show countries" aria-expanded={countryOpen}><ChevronDown size={16} /></button>
              </div>
              {countryOpen ? (
                <div className="sms-picker-menu" id="sms-country-options" role="listbox">
                  {countriesQuery.isLoading ? <div className="sms-picker-message"><LoaderCircle size={15} className="spin" /> Loading countries…</div> : countryMatches.length ? countryMatches.map((item) => (
                    <button type="button" className={`sms-picker-option ${item.code === country ? 'selected' : ''}`} key={item.code} onClick={() => chooseCountry(item)} role="option" aria-selected={item.code === country}>
                      <span className="sms-picker-option-copy"><span>{item.flag ? `${item.flag} ` : ''}{item.name}</span><small>{item.code}</small></span>
                      {item.code === country ? <Check size={16} /> : null}
                    </button>
                  )) : <div className="sms-picker-message">No countries match “{countrySearch}”.</div>}
                </div>
              ) : null}
            </div>
          </label>
          <label className="field"><span>Service</span>
            <div className={`sms-picker ${serviceOpen ? 'is-open' : ''}`}>
              <div className="sms-search-input sms-picker-input">
              <Search size={16} aria-hidden="true" />
              <input
                value={serviceSearch}
                onChange={(event) => { setServiceSearch(event.target.value); setServiceOpen(true); }}
                onFocus={() => {
                  setServiceOpen(true);
                  if (selectedService && serviceSearch === selectedService.name) setServiceSearch('');
                }}
                placeholder={selectedService?.name ?? (country ? 'Search apps and platforms' : 'Choose a country first')}
                aria-label="Search services"
                aria-expanded={serviceOpen}
                aria-controls="sms-service-options"
                role="combobox"
                disabled={!country || servicesQuery.isLoading}
                data-testid="input-sms-service-search"
              />
              {serviceSearch ? <button type="button" className="sms-picker-clear" onClick={() => setServiceSearch('')} aria-label="Clear service search"><X size={15} /></button> : null}
              <button type="button" className="sms-picker-toggle" onClick={() => setServiceOpen((open) => !open)} aria-label="Show services" aria-expanded={serviceOpen} disabled={!country || servicesQuery.isLoading}><ChevronDown size={16} /></button>
              </div>
              {serviceOpen ? (
                <div className="sms-picker-menu" id="sms-service-options" role="listbox">
                  {servicesQuery.isError ? (
                    <div className="sms-picker-message sms-picker-error">
                      <AlertCircle size={16} />
                      <span>Services could not be loaded.</span>
                      <button type="button" className="text-link" onClick={() => void servicesQuery.refetch()}>Try again</button>
                    </div>
                  ) : servicesQuery.isLoading ? <div className="sms-picker-message"><LoaderCircle size={15} className="spin" /> Loading services…</div> : serviceMatches.length ? serviceMatches.map((item) => (
                    <button type="button" className={`sms-picker-option ${item.id === service ? 'selected' : ''}`} key={item.id} onClick={() => chooseService(item)} role="option" aria-selected={item.id === service}>
                      <span className="sms-picker-option-copy"><span>{item.name}</span><small>{naira.format(item.price)}</small></span>
                      {item.id === service ? <Check size={16} /> : null}
                    </button>
                  )) : <div className="sms-picker-message">No services match “{serviceSearch}”.</div>}
                </div>
              ) : null}
            </div>
          </label>
          <div className={`sms-catalog-state ${servicesQuery.isError ? 'is-error' : ''}`} aria-live="polite">
            {servicesQuery.isError ? <><AlertCircle size={15} /> <span>{serviceStatus}</span> <button type="button" className="text-link" onClick={() => void servicesQuery.refetch()}>Retry</button></> : serviceStatus}
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          {success && <div className="success-box" role="status"><Check size={17} /><div><b>Refund completed</b><span>{success}</span></div></div>}
          <button className="btn btn-primary full-btn" type="submit" disabled={!country || !service || buyNumber.isPending || !selectedService} data-testid="button-buy-sms-number">
            {buyNumber.isPending ? <><LoaderCircle size={17} className="spin" /> Getting your number…</> : <>Get a number <span>{selectedService ? naira.format(selectedService.price) : ''}</span></>}
          </button>
          <p className="sms-footnote"><ShieldCheck size={15} /> The server checks the live price and charges your wallet before ordering.</p>
        </form>

        <div className="panel sms-inbox-panel">
          <div className="section-head"><div><h2>Your active number</h2><span>New messages are checked automatically.</span></div><MessageSquareText size={19} className="accent-icon" /></div>
          {active ? (
            <div className="sms-active">
              <div className="sms-number-row"><div><small>{active.service} · {active.country}</small><strong>{active.number}</strong></div><button className="icon-btn" type="button" onClick={copyNumber} aria-label="Copy phone number">{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>
              <div className={`sms-code-card ${liveCode?.code || active.code ? 'has-code' : ''}`}>
                {liveCode?.code || active.code
                  ? <><small>Verification code</small><strong>{liveCode?.code ?? active.code}</strong>{liveCode?.fullSms && <p>{liveCode.fullSms}</p>}</>
                  : <><Clock3 size={20} /><strong>{active.status === 'pending' ? 'Waiting for SMS' : `Status: ${active.status}`}</strong><p>Leave this page open or return to your SMS history later.</p></>}
              </div>
              <div className="sms-active-actions">
                <button type="button" className="btn btn-secondary" onClick={() => void refreshCode(active.activationId)} disabled={checking} data-testid="button-refresh-sms">
                  <RefreshCw size={16} className={checking ? 'spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
                </button>
                {active.status === 'pending' && !active.code ? (
                  <button type="button" className="btn btn-secondary sms-cancel-btn" onClick={() => void cancelActivation()} disabled={!canCancel || cancelling} data-testid="button-cancel-sms">
                    <X size={16} /> {cancelling ? 'Cancelling…' : canCancel ? 'Cancel & refund' : `Refund available in ${formatRemaining(cancelRemaining ?? SMS_CANCEL_AFTER_MS)}`}
                  </button>
                ) : null}
                <span>Order ref. <code>{active.activationId}</code></span>
              </div>
            </div>
          ) : (
            <div className="sms-empty"><span className="empty-icon"><MessageSquareText size={22} /></span><b>No active number yet</b><p>Choose a country and service to get started.</p></div>
          )}
        </div>
      </div>

      <section className="panel sms-history-panel">
        <div className="section-head"><div><h2>Recent activations</h2><span>Your SMS number orders on this account</span></div><button className="text-link" type="button" onClick={() => void historyQuery.refetch()} data-testid="button-refresh-sms-history"><RefreshCw size={15} /> Refresh</button></div>
        {historyQuery.isLoading ? <div className="loading-inline">Loading SMS history…</div> : historyQuery.isError ? <div className="error-box">Could not load activation history.</div> : history.length ? (
          <div className="sms-history-list">{history.slice(0, 8).map((item) => <button type="button" className={`sms-history-row ${active?.activationId === item.activationId ? 'selected' : ''}`} key={item.activationId} onClick={() => { setActive(item); setLiveCode(item.code ? { activationId: item.activationId, status: item.status, code: item.code } : null); }}>
            <span className="sms-history-icon"><MessageSquareText size={16} /></span><span className="sms-history-copy"><b>{item.service} · {item.country}</b><small>{item.number} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Recently'}</small></span><span className={`status-pill status-${item.status}`}>{item.code ?? item.status}</span>
          </button>)}</div>
        ) : <div className="loading-inline">No SMS activations yet.</div>}
      </section>
    </>
  );
}