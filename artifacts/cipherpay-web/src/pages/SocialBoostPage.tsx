import { ArrowLeft, ArrowRight, Check, Clock3, ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { apiRequest } from './page-api';
import { PageHeading } from './PagePieces';

type SocialService = {
  id: string;
  name: string;
  platform: string;
  category: string;
  pricePerUnit: number;
  minQuantity: number;
  maxQuantity: number;
  unit: string;
  description: string;
  deliveryTime: string;
  quality: string;
  providerRate?: number;
  platformFee?: number;
  refill?: boolean;
  cancel?: boolean;
  dripfeed?: boolean;
  refillDays?: number;
  providerClaims?: string[];
  providerServiceName?: string;
  providerServiceId?: number;
};

type SocialOrder = {
  id: number;
  serviceName: string;
  platform: string;
  link: string;
  quantity: number;
  amount: number;
  status: string;
  remainsCount?: number;
  createdAt: string;
};

const platformLabels: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'Twitter / X',
  facebook: 'Facebook',
  telegram: 'Telegram',
  threads: 'Threads',
  snapchat: 'Snapchat',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
};

function naira(value: number) {
  return `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatGroupedDigits(value: string | number) {
  const digits = String(value).replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

function parseGroupedDigits(value: string) {
  return Number(value.replace(/,/g, '')) || 0;
}

function prettyStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const terminalStatuses = new Set(['completed', 'cancelled', 'failed']);

export default function SocialBoostPage() {
  const [services, setServices] = useState<SocialService[]>([]);
  const [orders, setOrders] = useState<SocialOrder[]>([]);
  const [platform, setPlatform] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refreshLiveStatuses = useCallback(async (items: SocialOrder[]) => {
    const active = items.filter((order) => !terminalStatuses.has(order.status));
    const checked = await Promise.all(active.map(async (order) => {
      try {
        return await apiRequest<SocialOrder>(`/api/social/orders/${order.id}/status`);
      } catch {
        return order;
      }
    }));
    const byId = new Map(checked.map((order) => [order.id, order]));
    return items.map((order) => byId.get(order.id) ?? order);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [serviceResult, orderResult] = await Promise.all([
        apiRequest<SocialService[]>('/api/social/services'),
        apiRequest<{ data: SocialOrder[] }>('/api/social/orders?limit=8'),
      ]);
      setServices(serviceResult);
      setOrders(await refreshLiveStatuses(orderResult.data ?? []));
      setPlatform((current) => current || serviceResult[0]?.platform || '');
      setServiceId((current) => current || serviceResult[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Social Boost is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [refreshLiveStatuses]);

  useEffect(() => { void load(); }, [load]);

  const platforms = useMemo(() => Array.from(new Set(services.map((service) => service.platform))), [services]);
  const platformServices = useMemo(
    () => services.filter((service) => service.platform === platform),
    [platform, services],
  );
  const selectedService = services.find((service) => service.id === serviceId) ?? platformServices[0];
  const total = selectedService ? selectedService.pricePerUnit * parseGroupedDigits(quantity || String(selectedService.minQuantity)) + (selectedService.platformFee ?? 200) : 0;

  useEffect(() => {
    if (!platformServices.some((service) => service.id === serviceId)) {
      setServiceId(platformServices[0]?.id ?? '');
    }
  }, [platformServices, serviceId]);

  useEffect(() => {
    if (selectedService && !quantity) setQuantity(formatGroupedDigits(selectedService.minQuantity));
  }, [selectedService, quantity]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedService) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiRequest<{ message?: string }>('/api/social/order', {
        method: 'POST',
        body: { serviceId: selectedService.id, link: link.trim(), quantity: parseGroupedDigits(quantity) },
      });
      setSuccess(result.message ?? 'Your Social Boost order was placed.');
      setLink('');
       setQuantity(formatGroupedDigits(selectedService.minQuantity));
      const updated = await apiRequest<{ data: SocialOrder[] }>('/api/social/orders?limit=8');
      setOrders(await refreshLiveStatuses(updated.data ?? []));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Social Boost order could not be placed.');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshOrders = async () => {
    setRefreshing(true);
    try {
      const updated = await apiRequest<{ data: SocialOrder[] }>('/api/social/orders?limit=8');
       setOrders(await refreshLiveStatuses(updated.data ?? []));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Orders could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshOrders();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [orders.length]);

  return <>
    <PageHeading
      eyebrow="SOCIAL BOOST / LIVE PROVIDER CATALOGUE"
      title="Give your content more reach."
      detail="Services, prices, limits and fulfilment capabilities are read from the connected provider catalogue. Provider claims are shown exactly as capabilities, not guaranteed results."
      actions={undefined}
    />
    <div className="social-boost-layout">
      <section className="panel social-boost-form-panel">
        <div className="service-intro"><span className="social-boost-mark"><Megaphone size={20} /></span><div><h2>Place a boost order</h2><p>Orders are sent to a verified delivery partner and tracked here. Delivery times vary by service.</p></div></div>
        {loading ? <div className="loading-inline">Loading current services…</div> : <form className="service-form" onSubmit={submit}>
          <label className="field"><span>Platform</span><select value={platform} onChange={(event) => setPlatform(event.target.value)} required><option value="">Choose a platform</option>{platforms.map((item) => <option key={item} value={item}>{platformLabels[item] ?? item}</option>)}</select></label>
          <label className="field"><span>Service</span><select value={selectedService?.id ?? ''} onChange={(event) => setServiceId(event.target.value)} required><option value="">Choose a service</option>{platformServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          {selectedService && <div className="social-service-detail"><span>{selectedService.description}</span><small><Clock3 size={13} /> {selectedService.deliveryTime} · {selectedService.quality}</small><div className="social-provider-meta"><span><b>Provider service</b>{selectedService.providerServiceName ?? "Live provider match"}</span><span><b>Provider rate</b>{naira(selectedService.providerRate ?? 0)} / 1,000</span><span><b>Order limits</b>{formatGroupedDigits(selectedService.minQuantity)} – {formatGroupedDigits(selectedService.maxQuantity)}</span><span><b>Refill / drop</b>{selectedService.refillDays ? selectedService.refillDays + "-day refill" : selectedService.refill ? "Refill available" : "No refill flag"}</span><span><b>Cancel</b>{selectedService.cancel ? "Supported" : "Not supported"}</span><span><b>Delivery</b>{selectedService.dripfeed ? "Drip-feed available" : "Standard delivery"}</span></div>{!!selectedService.providerClaims?.length && <div className="social-provider-badges">{selectedService.providerClaims.map((claim) => <span key={claim}>{claim}</span>)}</div>}</div>}
          <label className="field"><span>Public post or profile link</span><input type="url" value={link} onChange={(event) => setLink(event.target.value)} required placeholder="https://…" /></label>
          <div className="field-row"><label className="field"><span>Quantity</span><input type="text" inputMode="numeric" min={selectedService?.minQuantity} max={selectedService?.maxQuantity} value={quantity} onChange={(event) => setQuantity(formatGroupedDigits(event.target.value))} required /></label><div className="social-total"><span>Total</span><strong>{naira(total)}</strong><small>{selectedService ? `${naira(selectedService.pricePerUnit)} per ${selectedService.unit} + ${naira(selectedService.platformFee ?? 200)} platform fee` : 'Select a service'}</small></div></div>
          {error && <div className="error-box" role="alert">{error}</div>}
          {success && <div className="success-box"><Check size={17} /><div><b>Order placed</b><span>{success}</span></div></div>}
          <button type="submit" className="btn btn-primary full-btn" disabled={submitting || !selectedService}>{submitting ? 'Placing order…' : 'Place boost order'} <ArrowRight size={17} /></button>
        </form>}
      </section>
      <aside className="panel social-boost-side"><h3>Simple, visible, trackable.</h3><p>Your wallet is debited only when the delivery partner accepts the order. We refresh progress here, and any order still incomplete after 24 hours is automatically refunded.</p><div className="side-rule" /><span className="mono">BOOST / LIVE TRACKING</span></aside>
    </div>
    <section className="panel social-orders-panel"><div className="section-head"><div><h2>Recent boost orders</h2><span>Track your latest social fulfilment requests.</span></div><button type="button" className="btn btn-secondary" onClick={() => void refreshOrders()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'admin-spin' : ''} /> Refresh</button></div>{orders.length ? <div className="social-orders-list">{orders.map((order) => { const delivered = Math.max(0, order.quantity - (order.remainsCount ?? order.quantity)); return <div className="social-order-row" key={order.id}><span className="social-order-icon"><Megaphone size={15} /></span><span className="social-order-copy"><b>{order.serviceName}</b><small>{platformLabels[order.platform] ?? order.platform} · {delivered.toLocaleString()} / {order.quantity.toLocaleString()} delivered · {new Date(order.createdAt).toLocaleDateString('en-NG')}</small></span><span className={`status-pill status-${order.status}`} >{order.status === 'cancelled' ? 'Refunded' : prettyStatus(order.status)}</span><a href={order.link} target="_blank" rel="noreferrer" aria-label={`Open link for ${order.serviceName}`}><ExternalLink size={15} /></a></div>; })}</div> : <div className="empty-state"><Megaphone size={22} /><b>No boost orders yet</b><span>Your recent orders will appear here.</span></div>}</section>
  </>;
}