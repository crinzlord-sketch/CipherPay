import { Check, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useChangePassword } from '@workspace/api-client-react';
import { Button, Notice, PageHeading } from './PagePieces';
import { apiRequest } from './page-api';

export function SettingsPage() {
  const password = useChangePassword();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const [pinNotice, setPinNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [pinSaving, setPinSaving] = useState(false);
  useEffect(() => {
    const apply = (value: string | null) => { const next = value === 'dark' ? 'dark' : 'light'; setTheme(next); document.documentElement.classList.toggle('dark', next === 'dark'); document.documentElement.style.colorScheme = next; };
    apply(window.localStorage.getItem('cipherpay_theme'));
    const onStorage = (event: StorageEvent) => { if (event.key === 'cipherpay_theme') apply(event.newValue); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const chooseTheme = (next: 'light' | 'dark') => { setTheme(next); document.documentElement.classList.toggle('dark', next === 'dark'); document.documentElement.style.colorScheme = next; window.localStorage.setItem('cipherpay_theme', next); window.dispatchEvent(new StorageEvent('storage', { key: 'cipherpay_theme', newValue: next })); };
  const changeTransactionPin = async (event: React.FormEvent) => {
    event.preventDefault();
    setPinNotice(null);
    if (!/^\d{6}$/.test(pinForm.currentPin) || !/^\d{6}$/.test(pinForm.newPin) || !/^\d{6}$/.test(pinForm.confirmPin)) {
      setPinNotice({ text: 'All transaction PINs must be exactly 6 digits.', tone: 'error' });
      return;
    }
    if (pinForm.newPin !== pinForm.confirmPin) {
      setPinNotice({ text: 'The new PINs do not match.', tone: 'error' });
      return;
    }
    if (pinForm.newPin === pinForm.currentPin) {
      setPinNotice({ text: 'Your new PIN must be different from the current PIN.', tone: 'error' });
      return;
    }
    setPinSaving(true);
    try {
      await apiRequest('/api/auth/pin/set', {
        method: 'POST',
        body: { currentPin: pinForm.currentPin, pin: pinForm.newPin, confirmPin: pinForm.confirmPin },
      });
      setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
      setPinNotice({ text: 'Transaction PIN changed successfully.', tone: 'success' });
    } catch (reason: any) {
      setPinNotice({ text: reason?.message ?? 'Could not change your transaction PIN.', tone: 'error' });
    } finally {
      setPinSaving(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setNotice(null);
    if (form.newPassword.length < 6) { setNotice({ text: 'Use at least 6 characters for your new password.', tone: 'error' }); return; }
    if (form.newPassword !== form.confirmPassword) { setNotice({ text: 'The new passwords do not match.', tone: 'error' }); return; }
    password.mutate({ data: { currentPassword: form.currentPassword, newPassword: form.newPassword } }, { onSuccess: () => { setForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setNotice({ text: 'Password changed successfully.', tone: 'success' }); }, onError: (reason: any) => setNotice({ text: reason?.message ?? 'Could not change your password.', tone: 'error' }) });
  };
  return <div className="cp-page">
    <PageHeading eyebrow="CIPHERPAY / PREFERENCES" title="Settings." detail="Choose how CipherPay looks and keep your account access secure." />
    <div className="cp-grid cp-grid-two">
      <section className="cp-card cp-card-pad"><div className="cp-card-head"><div><h2>Appearance</h2><p>Your preference is saved on this device.</p></div></div><div className="cp-preference-row"><div><h3>Theme</h3><p>Light is bright and open. Dark is softer after hours.</p></div><div className="cp-segmented" role="group" aria-label="Theme preference"><button className={theme === 'light' ? 'active' : ''} type="button" onClick={() => chooseTheme('light')} data-testid="button-theme-light"><Sun size={14} /> Light</button><button className={theme === 'dark' ? 'active' : ''} type="button" onClick={() => chooseTheme('dark')} data-testid="button-theme-dark"><Moon size={14} /> Dark</button></div></div></section>
      <section className="cp-card cp-card-pad"><div className="cp-card-head"><div><h2>Change password</h2><p>Use a password you do not reuse elsewhere.</p></div><ShieldCheck size={19} color="hsl(var(--primary))" /></div><form className="cp-form" onSubmit={submit}><label className="cp-field"><span>Current password</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required data-testid="input-current-password" /></label><label className="cp-field"><span>New password</span><input type="password" autoComplete="new-password" minLength={6} value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required data-testid="input-new-password" /></label><label className="cp-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={6} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} required data-testid="input-confirm-password" /></label>{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}<Button type="submit" disabled={password.isPending} data-testid="button-change-password">{password.isPending ? 'Changing password…' : 'Change password'} <Check size={15} /></Button></form></section>
      <section className="cp-card cp-card-pad"><div className="cp-card-head"><div><h2>Transaction PIN</h2><p>Change the PIN used to authorize transfers and payments. Your current PIN is required.</p></div><ShieldCheck size={19} color="hsl(var(--primary))" /></div><form className="cp-form" onSubmit={changeTransactionPin}><label className="cp-field"><span>Current transaction PIN</span><input type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={pinForm.currentPin} onChange={(event) => setPinForm({ ...pinForm, currentPin: event.target.value.replace(/\D/g, '').slice(0, 6) })} required data-testid="input-current-transaction-pin" /></label><label className="cp-field"><span>New transaction PIN</span><input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pinForm.newPin} onChange={(event) => setPinForm({ ...pinForm, newPin: event.target.value.replace(/\D/g, '').slice(0, 6) })} required data-testid="input-new-transaction-pin" /></label><label className="cp-field"><span>Confirm new transaction PIN</span><input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pinForm.confirmPin} onChange={(event) => setPinForm({ ...pinForm, confirmPin: event.target.value.replace(/\D/g, '').slice(0, 6) })} required data-testid="input-confirm-transaction-pin" /></label>{pinNotice && <Notice tone={pinNotice.tone}>{pinNotice.text}</Notice>}<Button type="submit" disabled={pinSaving} data-testid="button-change-transaction-pin">{pinSaving ? 'Changing PIN…' : 'Change transaction PIN'} <Check size={15} /></Button></form></section>
    </div>
  </div>;
}