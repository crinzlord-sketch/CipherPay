import { Check, Pencil, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMe, useUpdateProfile } from '@workspace/api-client-react';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import { initials, apiRequest } from './page-api';
import { CipherAvatar } from '../components/CipherAvatar';

export function ProfilePage() {
  const queryClient = useQueryClient();
  const profile = useGetMe({ query: { queryKey: ['/api/auth/me'] } });
  const update = useUpdateProfile();
  const user: any = profile.data;
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  useEffect(() => { if (user) { setForm({ firstName: user.firstName ?? '', lastName: user.lastName ?? '', phone: user.phone ?? '' }); if (user.gender === 'female') setGender('female'); else if (user.gender === 'male') setGender('male'); } }, [user]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setNotice(null);
    apiRequest<any>('/api/auth/update-profile', { method: 'PATCH', body: { ...form, gender } }).then((saved: any) => {
        queryClient.setQueryData(['/api/auth/me'], saved);
        void queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        setEditing(false);
        setNotice({ text: 'Your profile is up to date.', tone: 'success' });
      }).catch((reason: any) => setNotice({ text: reason?.message ?? 'Could not save your profile.', tone: 'error' }));
    return;
    update.mutate({ data: form }, {
      onSuccess: (saved: any) => {
        queryClient.setQueryData(['/api/auth/me'], saved);
        void queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        setEditing(false);
        setNotice({ text: 'Your profile is up to date.', tone: 'success' });
      },
      onError: (reason: any) => setNotice({ text: reason?.message ?? 'Could not save your profile.', tone: 'error' }),
    });
  };
  const cancelEdit = () => {
    setForm({ firstName: user.firstName ?? '', lastName: user.lastName ?? '', phone: user.phone ?? '' }); setGender(user.gender === 'female' ? 'female' : 'male');
    setEditing(false);
    setNotice(null);
  };
  if (profile.isLoading) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / ACCOUNT" title="Your profile." detail="Keep your account details current." /><LoadingState label="Loading your profile" /></div>;
  if (profile.isError || !user) return <div className="cp-page"><PageHeading eyebrow="CIPHERPAY / ACCOUNT" title="Your profile." detail="Keep your account details current." /><ErrorState retry={() => void profile.refetch()} /></div>;
  return <div className="cp-page">
    <PageHeading eyebrow="CIPHERPAY / ACCOUNT" title="Your profile." detail="Keep your account details current so payments and security checks reach you." actions={!editing && <Button type="button" variant="soft" onClick={() => { setNotice(null); setEditing(true); }} data-testid="button-edit-profile"><Pencil size={15} /> Edit profile</Button>} />
    <div className="cp-grid cp-grid-two">
      <section className="cp-card cp-card-pad"><div className="cp-profile-identity"><CipherAvatar src={user.avatarUrl} seed={user.id || user.email} gender={user.gender} size={88} alt={`${user.firstName} ${user.lastName}`} /><div><h2>{user.firstName} {user.lastName}</h2><p>{user.email}</p></div></div>
        {editing ? <form className="cp-form" onSubmit={submit}><div className="cp-field-row"><label className="cp-field"><span>First name</span><input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required data-testid="input-profile-first-name" /></label><label className="cp-field"><span>Last name</span><input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required data-testid="input-profile-last-name" /></label></div><label className="cp-field"><span>Phone number</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required data-testid="input-profile-phone" /></label><label className="cp-field"><span>Avatar style</span><select value={gender} onChange={(event) => setGender(event.target.value as 'male' | 'female')} data-testid="select-profile-avatar-gender"><option value="male">Male</option><option value="female">Female</option></select></label>{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}<div className="cp-actions"><Button type="button" variant="quiet" onClick={cancelEdit} disabled={update.isPending} data-testid="button-cancel-profile"><X size={15} /> Cancel</Button><Button type="submit" disabled={update.isPending} data-testid="button-save-profile">{update.isPending ? 'Saving changes…' : 'Save changes'} <Check size={15} /></Button></div></form> : <div className="cp-profile-details">
          <div className="cp-profile-detail-row"><div className="cp-profile-detail"><span>First name</span><strong>{user.firstName || 'Not added'}</strong></div><div className="cp-profile-detail"><span>Last name</span><strong>{user.lastName || 'Not added'}</strong></div></div>
          <div className="cp-profile-detail-row"><div className="cp-profile-detail"><span>Email address</span><strong>{user.email || 'Not added'}</strong></div><div className="cp-profile-detail"><span>Phone number</span><strong>{user.phone || 'Not added'}</strong></div></div>
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </div>}
      </section>
      <aside className="cp-card cp-card-pad cp-security-card"><span className="cp-security-mark"><UserRound size={20} /></span><h2>Your details, under your control.</h2><p>We use your profile information to keep transfers clear and your account protected. You can update it whenever something changes.</p><div className="cp-divider" /><span className="cp-kicker">ACCOUNT SINCE</span><p>{user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }) : 'CipherPay member'}</p></aside>
    </div>
  </div>;
}