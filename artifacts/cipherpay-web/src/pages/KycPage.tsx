import { ArrowRight, CheckCircle2, FileCheck2, LockKeyhole, ShieldCheck, WalletCards, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
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
  const [openForm, setOpenForm] = useState(false);

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

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setNotice(null);
    if (!/^\d{11}$/.test(form.nin.trim())) { setNotice({ text: 'Enter a valid 11-digit NIN.', tone: 'error' }); return; }
    if (form.fullName.trim().split(/\s+/).length < 2) { setNotice({ text: 'Enter your full name.', tone: 'error' }); return; }
    if (!form.dateOfBirth) { setNotice({ text: 'Add your date of birth.', tone: 'error' }); return; }
    if (form.address.trim().length < 8) { setNotice({ text: 'Add your residential address.', tone: 'error' }); return; }
    setSaving(true);
    try {
      const next = await apiRequest<KycStatus>('/api/kyc/submit', { method: 'POST', body: { verificationType: 'basic', documentType: 'nin', documentNumber: form.nin, nin: form.nin, fullName: form.fullName, dateOfBirth: form.dateOfBirth, address: form.address } });
      setStatus(next); setOpenForm(false); setNotice({ text: 'Your KYC details were submitted for review.', tone: 'success' });
    } catch (e) { setNotice({ text: e instanceof Error ? e.message : 'Could not submit KYC.', tone: 'error' }); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Simple KYC." detail="A straightforward identity check." /><LoadingState label="Loading your verification" /></div>;
  if (!status) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Simple KYC." detail="A straightforward identity check." /><ErrorState retry={() => void load()} /></div>;
  const verified = status.status === 'verified';
  const submitted = status.status === 'submitted';

  return <div className="cp-page">
    <PageHeading eyebrow="CIPHERPAY / IDENTITY" title="Identity & KYC." detail="Verify once to unlock higher account limits." />
    {notice && <div style={{ marginBottom: 16 }}><Notice tone={notice.tone}>{notice.text}</Notice></div>}
    {verified ? <section className="cp-card cp-card-pad cp-kyc-status-card">
      <div className="cp-kyc-status-icon"><CheckCircle2 size={24}/></div><span className="cp-kicker">VERIFIED</span><h2>Your KYC is verified.</h2><p>Your basic identity check is complete.</p>
    </section> : submitted ? <section className="cp-card cp-card-pad cp-kyc-status-card">
      <div className="cp-kyc-status-icon"><ShieldCheck size={24}/></div><span className="cp-kicker">UNDER REVIEW</span><h2>Your KYC is being reviewed.</h2><p>Your details have been received. We’ll notify you when the review is complete.</p>
    </section> : !openForm ? <div className="cp-grid cp-grid-two">
      <section className="cp-card cp-card-pad cp-kyc-status-card">
        <div className="cp-kyc-status-icon cp-kyc-unverified"><XCircle size={24}/></div><span className="cp-kicker">UNVERIFIED</span><h2>Your KYC isn’t verified yet.</h2><p>You can still use CipherPay, but your account remains on unverified limits until you complete the basic check.</p>
        {status.rejectionReason && <Notice tone="error">{status.rejectionReason}</Notice>}
        <Button type="button" onClick={() => setOpenForm(true)}>Start verification <ArrowRight size={16}/></Button>
      </section>
      <aside className="cp-card cp-card-pad">
        <div className="cp-card-head"><div><span className="cp-kicker">WITHOUT KYC</span><h2>What stays limited</h2></div><LockKeyhole size={19}/></div>
        <div className="cp-kyc-limits">
          <div><WalletCards size={17}/><span><strong>₦5,000 per transaction</strong><small>Unverified account transaction limit.</small></span></div>
          <div><XCircle size={17}/><span><strong>Higher deposits can be held</strong><small>Deposits above the unverified limit may be held for KYC review.</small></span></div>
          <div><ShieldCheck size={17}/><span><strong>Higher limits stay locked</strong><small>Basic verification raises the applicable account limit.</small></span></div>
        </div>
      </aside>
    </div> : <section className="cp-card cp-card-pad">
      <div className="cp-card-head"><div><span className="cp-kicker">BASIC VERIFICATION</span><h2>Verify your identity</h2><p>Just the essentials — no advanced KYC flow.</p></div><span className="cp-privacy-chip"><LockKeyhole size={14}/> Protected</span></div>
      <form className="cp-form" onSubmit={submit}>
        <label className="cp-field"><span>NIN</span><input value={form.nin} onChange={e => setForm({ ...form, nin: e.target.value.replace(/\D/g,'').slice(0,11) })} inputMode="numeric" placeholder="11-digit NIN" /></label>
        <label className="cp-field"><span>Full name</span><input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Your full legal name" /></label>
        <label className="cp-field"><span>Date of birth</span><input type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
        <label className="cp-field"><span>Residential address</span><textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Where you currently live" rows={3} /></label>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><Button type="button" variant="secondary" onClick={() => setOpenForm(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit verification'} <CheckCircle2 size={16}/></Button></div>
      </form>
    </section>}
  </div>;
}
