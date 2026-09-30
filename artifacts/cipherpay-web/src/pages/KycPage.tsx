import { CheckCircle2, FileCheck2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import './cipherpay-pages.css';

type KycStatus = {
  status: 'not_started' | 'submitted' | 'verified' | 'rejected';
  level?: number;
  nin?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
};

export function KycPage() {
  const [status, setStatus] = useState<KycStatus | null>(null);
  const [form, setForm] = useState({ nin: '', fullName: '', dateOfBirth: '', address: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const next = await apiRequest<KycStatus>('/api/kyc/status');
      setStatus(next);
      setForm({
        nin: next.nin ?? '',
        fullName: next.fullName ?? '',
        dateOfBirth: next.dateOfBirth ?? '',
        address: next.address ?? '',
      });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not load KYC.', tone: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setNotice(null);
    if (!/^\d{11}$/.test(form.nin.trim())) { setNotice({ text: 'Enter a valid 11-digit NIN.', tone: 'error' }); return; }
    if (form.fullName.trim().split(/\s+/).length < 2) { setNotice({ text: 'Enter your full name.', tone: 'error' }); return; }
    if (!form.dateOfBirth) { setNotice({ text: 'Add your date of birth.', tone: 'error' }); return; }
    if (form.address.trim().length < 8) { setNotice({ text: 'Add your residential address.', tone: 'error' }); return; }
    setSaving(true);
    try {
      const next = await apiRequest<KycStatus>('/api/kyc/submit', { method: 'POST', body: { verificationType: 'basic', documentType: 'nin', documentNumber: form.nin, nin: form.nin, fullName: form.fullName, dateOfBirth: form.dateOfBirth, address: form.address } });
      setStatus(next); setNotice({ text: 'Your KYC details were submitted for review.', tone: 'success' });
    } catch (e) { setNotice({ text: e instanceof Error ? e.message : 'Could not submit KYC.', tone: 'error' }); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Simple KYC." detail="A straightforward identity check." /><LoadingState label="Loading your verification" /></div>;
  if (!status) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Simple KYC." detail="A straightforward identity check." /><ErrorState retry={() => void load()} /></div>;
  const locked = status.status === 'submitted' || status.status === 'verified';
  return <div className="cp-page">
    <PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Simple KYC." detail="Just the essentials. No advanced document or selfie process." />
    <div className="cp-grid cp-grid-two">
      <section className="cp-card cp-card-pad">
        <div className="cp-card-head"><div><span className="cp-kicker">IDENTITY CHECK</span><h2>{status.status === 'verified' ? 'Identity verified' : status.status === 'submitted' ? 'Under review' : 'Verify your identity'}</h2><p>We need your NIN, basic personal details and residential address.</p></div><span className="cp-privacy-chip"><LockKeyhole size={14} /> Protected</span></div>
        {status.status === 'verified' && <Notice tone="success">Your KYC is verified.</Notice>}
        {status.status === 'submitted' && <Notice tone="success">Your details are under review.</Notice>}
        {status.status === 'rejected' && status.rejectionReason && <Notice tone="error">{status.rejectionReason}</Notice>}
        <form className="cp-form" onSubmit={submit}>
          <fieldset disabled={locked || saving} className="cp-fieldset">
            <label className="cp-field"><span>NIN</span><input value={form.nin} onChange={e => setForm({ ...form, nin: e.target.value.replace(/\D/g,'').slice(0,11) })} inputMode="numeric" placeholder="11-digit NIN" /></label>
            <label className="cp-field"><span>Full name</span><input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="As it appears on your ID" /></label>
            <label className="cp-field"><span>Date of birth</span><input type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
            <label className="cp-field"><span>Residential address</span><textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Where you currently live" rows={3} /></label>
          </fieldset>
          {!locked && <Button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit KYC'} <CheckCircle2 size={16} /></Button>}
        </form>
      </section>
      <aside className="cp-card cp-card-pad cp-security-card"><span className="cp-security-mark"><ShieldCheck size={20} /></span><h2>Nothing excessive.</h2><p>We keep this check focused on the information needed to verify your identity and protect your account.</p><div className="cp-divider" /><div className="cp-kyc-check"><CheckCircle2 size={15} /> NIN</div><div className="cp-kyc-check"><CheckCircle2 size={15} /> Name & date of birth</div><div className="cp-kyc-check"><CheckCircle2 size={15} /> Residential address</div></aside>
    </div>
  </div>;
}
