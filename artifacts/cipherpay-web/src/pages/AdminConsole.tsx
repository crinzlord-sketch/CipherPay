import {
  AlertTriangle, Ban, Check, CheckCircle2, ChevronRight, CircleDollarSign,
  ClipboardCheck, CreditCard, Database, FileText, Flag, Headphones, LifeBuoy,
  Image as ImageIcon, Mail, MessageCircle, Paperclip, RefreshCw, Search, Send, ShieldCheck, Smartphone,
  Trash2, UserCheck, Users, WalletCards, X, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAnimatedDialog } from '../components/animated-dialog';
import { apiUrl, formatWhen } from './page-api';
import './admin.css';

type Tab = 'overview' | 'users' | 'admins' | 'support' | 'money' | 'verification' | 'activity';
type AdminOptions = { method?: string; body?: unknown; headers?: Record<string, string> };

async function adminRequest<T>(path: string, token: string, options: AdminOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? 'The admin request could not be completed.');
  return payload as T;
}

function naira(value: unknown) {
  return `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatGroupedNumber(value: string | number) {
  const raw = String(value);
  const negative = raw.trim().startsWith('-');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return negative ? '-' : '';
  return `${negative ? '-' : ''}${Number(digits).toLocaleString('en-US')}`;
}

function statusClass(value: unknown) {
  return `admin-status admin-status-${String(value ?? 'unknown').toLowerCase().replaceAll('_', '-')}`;
}

function AdminButton({ children, onClick, variant = 'soft', disabled = false }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'soft' | 'danger' | 'quiet'; disabled?: boolean }) {
  return <button type="button" className={`admin-btn admin-btn-${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function StatCard({ icon: Icon, label, value, detail, tone = 'orange' }: { icon: typeof Users; label: string; value: string | number; detail?: string; tone?: string }) {
  return <div className={`admin-stat admin-stat-${tone}`}><span className="admin-stat-icon"><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div></div>;
}

export default function AdminConsole() {
  const { confirm, prompt } = useAnimatedDialog();
  const [token, setToken] = useState(() => typeof window === 'undefined' ? '' : sessionStorage.getItem('cipherpay_admin_token') ?? '');
  const [tab, setTab] = useState<Tab>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'support' ? 'support' : 'overview');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState<number | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [supportChats, setSupportChats] = useState<any[]>([]);
  const [supportFilter, setSupportFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [selectedSupport, setSelectedSupport] = useState<any>(null);
  const [kycRows, setKycRows] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [smsActivations, setSmsActivations] = useState<any[]>([]);
  const [socialOrders, setSocialOrders] = useState<any[]>([]);
  const [egressIp, setEgressIp] = useState('');
  const [broadcast, setBroadcast] = useState({ title: '', body: '', filter: 'all', email: false });
  const [broadcasting, setBroadcasting] = useState(false);
  const [supportDraft, setSupportDraft] = useState('');
  const [supportUploading, setSupportUploading] = useState(false);
  const supportImageRef = useRef<HTMLInputElement>(null);
  const [pendingSupportId, setPendingSupportId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('chatId');
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) ? id : null;
  });
  const [newAdmin, setNewAdmin] = useState({ email: '', password: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [meResult, statsResult, usersResult, transactionsResult, supportResult, kycResult, depositsResult, withdrawalsResult, smsResult, socialResult, adminsResult] = await Promise.all([
        adminRequest<any>('/api/admin/me', token),
        adminRequest<any>('/api/admin/stats', token),
        adminRequest<any>('/api/admin/users?limit=100', token),
        adminRequest<any>('/api/admin/transactions?limit=100', token),
        adminRequest<any>(`/api/admin/support/chats?status=${supportFilter}`, token),
        adminRequest<any>('/api/admin/kyc?status=submitted', token),
        adminRequest<any>('/api/admin/deposits/pending', token),
        adminRequest<any>('/api/admin/withdrawals/pending', token),
        adminRequest<any>('/api/admin/sms-activations', token),
        adminRequest<any>('/api/admin/social-orders', token),
        adminRequest<any>('/api/admin/admins', token),
      ]);
      setCurrentAdminId(meResult.id);
      setStats(statsResult);
      setUsers(usersResult.data ?? []);
      setTransactions(transactionsResult.data ?? []);
      setSupportChats(supportResult.data ?? []);
      setKycRows(kycResult.data ?? []);
      setDeposits(depositsResult.data ?? []);
      setWithdrawals(withdrawalsResult.data ?? []);
      setSmsActivations(smsResult.data ?? []);
      setSocialOrders(socialResult.data ?? []);
      setAdmins(adminsResult.data ?? []);
    } catch (caught) {
      if (caught instanceof Error && /token|admin|unauthorized|expired/i.test(caught.message)) {
        sessionStorage.removeItem('cipherpay_admin_token');
        setToken('');
      }
      setError(caught instanceof Error ? caught.message : 'The admin data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token, supportFilter]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!token || !selectedSupport?.chat?.id || selectedSupport.chat.status === 'closed') return undefined;
    const poll = window.setInterval(async () => {
      try {
        const last = selectedSupport.messages?.at(-1)?.id ?? 0;
        const result = await adminRequest<any>(`/api/admin/support/chats/${selectedSupport.chat.id}/poll?since=${last}`, token);
        setSelectedSupport((current: any) => current ? { ...current, chat: result.chat, messages: [...(current.messages ?? []), ...(result.messages ?? [])] } : current);
        setSupportChats((current) => current.map((chat) => chat.id === result.chat.id ? { ...chat, ...result.chat } : chat));
      } catch { /* The next poll retries without interrupting the console. */ }
    }, 5000);
    return () => window.clearInterval(poll);
  }, [selectedSupport?.chat?.id, selectedSupport?.chat?.status, token]);

  const run = async (path: string, options: AdminOptions = {}, successMessage?: string) => {
    if (!token) return null;
    setError('');
    try {
      const result = await adminRequest<any>(path, token, options);
      if (successMessage) setNotice(successMessage);
      await loadAll();
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action could not be completed.');
      return null;
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setUnlocking(true);
    setError('');
    try {
      const result = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const payload = await result.json().catch(() => null);
      if (!result.ok) throw new Error(payload?.error ?? 'Invalid admin credentials.');
      sessionStorage.setItem('cipherpay_admin_token', payload.token);
      setToken(payload.token);
      setPassword('');
      setNotice('Admin console unlocked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The console could not be unlocked.');
    } finally {
      setUnlocking(false);
    }
  };

  const searchUsers = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    try {
      const result = await adminRequest<any>(`/api/admin/users?limit=100&q=${encodeURIComponent(userQuery)}`, token);
      setUsers(result.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Users could not be searched.');
    }
  };

  const userAction = async (user: any, action: string) => {
    if (action === 'suspend') {
      const reason = await prompt({
        title: user.isSuspended ? 'Restore this account' : 'Suspend this account',
        description: user.isSuspended ? 'Add a note explaining why this account is being restored.' : 'Add a note explaining why this account is being suspended.',
        defaultValue: user.suspendReason ?? 'Reviewed by support',
        placeholder: 'Admin reason',
        confirmLabel: user.isSuspended ? 'Restore account' : 'Suspend account',
        destructive: !user.isSuspended,
      });
      if (reason === null) return;
      await run(`/api/admin/users/${user.id}/suspend`, { method: 'POST', body: { suspended: !user.isSuspended, reason } }, user.isSuspended ? 'Account restored.' : 'Account suspended.');
    }
    if (action === 'verify') await run(`/api/admin/users/${user.id}/verify`, { method: 'POST', body: { verified: !user.isVerified } }, user.isVerified ? 'Email verification removed.' : 'User marked as verified.');
    if (action === 'pin') {
      if (!await confirm({ title: 'Clear this app PIN?', description: 'The user will need to set a new PIN before using PIN-protected actions.', confirmLabel: 'Clear PIN', destructive: true })) return;
      await run(`/api/admin/users/${user.id}/pin-clear`, { method: 'POST', body: { reason: 'Cleared by support from admin console' } }, 'App PIN cleared.');
    }
    if (action === 'adjust') {
      const raw = await prompt({ title: 'Adjust wallet balance', description: 'Enter a positive amount to credit or a negative amount to debit, in NGN.', placeholder: 'e.g. 5,000 or -500', confirmLabel: 'Continue', format: 'grouped-number' });
      if (raw === null) return;
      const amount = Number(raw.replace(/,/g, ''));
      const reason = await prompt({ title: 'Add an audit reason', defaultValue: 'Account correction', placeholder: 'Required audit reason', confirmLabel: 'Adjust wallet' });
      if (reason === null) return;
      await run(`/api/admin/users/${user.id}/wallet-adjust`, { method: 'POST', body: { amount, reason } }, 'Wallet adjusted.');
    }
    if (action === 'set-balance') {
      const raw = await prompt({ title: 'Set wallet balance', description: 'Enter the exact wallet balance in NGN.', defaultValue: formatGroupedNumber(user.balance ?? 0), placeholder: 'Wallet balance', confirmLabel: 'Continue', format: 'grouped-number' });
      if (raw === null) return;
      const balance = Number(raw.replace(/,/g, ''));
      const reason = await prompt({ title: 'Add an audit reason', defaultValue: 'Balance correction', placeholder: 'Required audit reason', confirmLabel: 'Set balance' });
      if (reason === null) return;
      await run(`/api/admin/users/${user.id}/wallet-set`, { method: 'POST', body: { balance, reason } }, 'Wallet balance set.');
    }
    if (action === 'debit-to-admin') {
      const raw = await prompt({ title: 'Move funds to the admin wallet', description: 'Enter the amount to move from this user wallet, in NGN.', placeholder: 'Amount in NGN', confirmLabel: 'Continue', format: 'grouped-number' });
      if (raw === null) return;
      const amount = Number(raw.replace(/,/g, ''));
      const description = await prompt({ title: 'Describe this ledger movement', defaultValue: 'Admin service charge', placeholder: 'Required description', confirmLabel: 'Move funds' });
      if (!description) return;
      await run(`/api/admin/users/${user.id}/debit-to-admin`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { amount, description } }, 'Funds moved to the admin wallet.');
    }
    if (action === 'kyc') {
      const raw = await prompt({ title: 'Set KYC level', description: 'Choose a level from 0 to 3.', defaultValue: String(user.kycLevel ?? 0), placeholder: '0, 1, 2, or 3', confirmLabel: 'Set level' });
      if (raw === null) return;
      const level = Number(raw);
      await run(`/api/admin/users/${user.id}/set-kyc`, { method: 'POST', body: { level } }, `KYC level set to L${level}.`);
    }
    if (action === 'notify') {
      const title = await prompt({ title: 'Notification title', defaultValue: 'Message from CipherPay', placeholder: 'Title', confirmLabel: 'Continue' });
      if (!title) return;
      const body = await prompt({ title: 'Notification message', placeholder: 'Write the message', confirmLabel: 'Send notification' });
      if (!body) return;
      await run(`/api/admin/users/${user.id}/notify`, { method: 'POST', body: { title, body, email: false } }, 'Notification sent.');
    }
    if (action === 'email') {
      const subject = await prompt({ title: 'Email subject', placeholder: 'Subject', confirmLabel: 'Continue' });
      if (!subject) return;
      const message = await prompt({ title: 'Email message', placeholder: 'Write the email', confirmLabel: 'Send email' });
      if (!message) return;
      await run(`/api/admin/users/${user.id}/send-email`, { method: 'POST', body: { subject, message } }, 'Email sent.');
    }
    if (action === 'activity') {
      if (!await confirm({ title: 'Reset this user’s activity?', description: 'This removes their transactions, purchases, notifications, and wallet balance. This cannot be undone.', confirmLabel: 'Reset activity', destructive: true })) return;
      await run(`/api/admin/users/${user.id}/reset-activity`, { method: 'POST' }, 'User activity reset.');
    }
    if (action === 'delete') {
      if (!await confirm({ title: 'Delete this user permanently?', description: `${user.email} and all associated data will be deleted. This cannot be undone.`, confirmLabel: 'Delete user', destructive: true })) return;
      await run(`/api/admin/users/${user.id}`, { method: 'DELETE' }, 'User deleted.');
    }
  };

  const openSupport = async (id: number) => {
    try {
      const result = await adminRequest<any>(`/api/admin/support/chats/${id}`, token);
      setSelectedSupport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Support chat could not be opened.');
    }
  };

  useEffect(() => {
    if (!pendingSupportId || tab !== 'support' || !supportChats.some((chat) => chat.id === pendingSupportId)) return;
    void openSupport(pendingSupportId);
    setPendingSupportId(null);
  }, [pendingSupportId, supportChats, tab]);

  const supportAction = async (action: 'join' | 'close') => {
    if (!selectedSupport?.chat?.id) return;
    const result = await run(`/api/admin/support/chats/${selectedSupport.chat.id}/${action}`, { method: 'POST' }, action === 'join' ? 'Support chat claimed.' : 'Support chat closed.');
    if (result) {
      if (action === 'close') {
        setSelectedSupport(null);
        setSupportDraft('');
        return;
      }
      const refreshed = await adminRequest<any>(`/api/admin/support/chats/${selectedSupport.chat.id}`, token);
      setSelectedSupport(refreshed);
    }
  };

  const sendSupportMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!supportDraft.trim() || !selectedSupport?.chat?.id) return;
    const result = await run(`/api/admin/support/chats/${selectedSupport.chat.id}/message`, { method: 'POST', body: { body: supportDraft.trim() } }, 'Reply sent.');
    if (result?.message) {
      setSelectedSupport((current: any) => current ? { ...current, messages: [...(current.messages ?? []), result.message], chat: { ...current.chat, status: 'live' } } : current);
      setSupportDraft('');
    }
  };

  const uploadSupportImage = async (file: File) => {
    if (!selectedSupport?.chat?.id || supportUploading || selectedSupport.chat.status === 'closed') return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setSupportUploading(true);
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      const uploaded = await adminRequest<{ url: string }>(`/api/admin/support/chats/${selectedSupport.chat.id}/upload-image`, token, { method: 'POST', body: { imageData } });
      const result = await adminRequest<{ message: any }>(`/api/admin/support/chats/${selectedSupport.chat.id}/message`, token, { method: 'POST', body: { body: '📷 Image', imageUrl: uploaded.url } });
      setSelectedSupport((current: any) => current ? { ...current, messages: [...(current.messages ?? []), result.message] } : current);
      await loadAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The image could not be sent.');
    } finally {
      setSupportUploading(false);
      if (supportImageRef.current) supportImageRef.current.value = '';
    }
  };

  const broadcastNotice = async (event: FormEvent) => {
    event.preventDefault();
    setBroadcasting(true);
    await run('/api/admin/notifications/broadcast', { method: 'POST', body: broadcast }, 'Broadcast queued.');
    setBroadcasting(false);
    setBroadcast({ title: '', body: '', filter: 'all', email: false });
  };

  const createAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setCreatingAdmin(true);
    const result = await run('/api/admin/admins', { method: 'POST', body: newAdmin }, 'Admin account created.');
    if (result) setNewAdmin({ email: '', password: '' });
    setCreatingAdmin(false);
  };

  const removeAdmin = async (admin: any) => {
    if (admin.isMaster || admin.id === currentAdminId) return;
    if (!await confirm({
      title: 'Remove this admin?',
      description: `${admin.email} will lose access to the admin console and their account data will be deleted. This cannot be undone.`,
      confirmLabel: 'Remove admin',
      destructive: true,
    })) return;
    await run(`/api/admin/admins/${admin.id}`, { method: 'DELETE' }, 'Admin account removed.');
  };

  const visibleTransactions = useMemo(() => transactions.slice(0, 60), [transactions]);
  const supportGroups = useMemo(() => {
    const groups = new Map<string, { label: string; chats: any[] }>();
    supportChats.forEach((chat) => {
      const label = [chat.userFirstName, chat.userLastName].filter(Boolean).join(' ') || chat.userEmail || `User #${chat.userId}`;
      const key = String(chat.userId);
      const group: { label: string; chats: any[] } = groups.get(key) ?? { label, chats: [] };
      group.chats.push(chat);
      groups.set(key, group);
    });
    return Array.from(groups.values());
  }, [supportChats]);

  if (!token) {
    return <main className="cp-page admin-console"><div className="cp-heading"><div><div className="cp-kicker">CipherPay / operations</div><h1>Unlock the admin console.</h1><p>Review users, money movement, verification, and support from one controlled workspace.</p></div></div><section className="cp-card cp-card-pad admin-unlock"><div className="admin-unlock-icon"><ShieldCheck size={24} /></div><h2>Administrator verification required</h2><p>Use an admin email and password to issue a short-lived console token.</p><form className="cp-form" onSubmit={unlock}><label className="cp-field"><span>Admin email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="admin@example.com" /></label><label className="cp-field"><span>Admin password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Your admin password" /></label>{error && <div className="cp-notice cp-notice-error">{error}</div>}<button className="admin-btn admin-btn-primary" type="submit" disabled={unlocking}>{unlocking ? 'Unlocking…' : 'Unlock console'} <ChevronRight size={16} /></button></form></section></main>;
  }

  return <main className="cp-page admin-console cp-page-reveal">
    <div className="cp-heading admin-heading"><div><div className="cp-kicker">CipherPay / operations</div><h1>Admin command center.</h1><p>Every user, payment, verification queue, and support request in one place.</p></div><div className="admin-heading-actions"><AdminButton onClick={() => void loadAll()}><RefreshCw size={15} className={loading ? 'admin-spin' : ''} /> Refresh</AdminButton><AdminButton variant="quiet" onClick={() => { sessionStorage.removeItem('cipherpay_admin_token'); setToken(''); }}>Lock console</AdminButton></div></div>
    {error && <div className="cp-notice cp-notice-error admin-notice"><AlertTriangle size={16} />{error}</div>}
    {notice && <div className="cp-notice cp-notice-success admin-notice"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={15} /></button></div>}
    <nav className="admin-tabs" aria-label="Admin areas">{([
       ['overview', 'Overview', Zap], ['users', 'Users', Users], ['support', 'Support inbox', LifeBuoy],
      ['money', 'Money operations', CircleDollarSign], ['verification', 'Verification', ClipboardCheck], ['activity', 'Activity & tools', Database], ['admins', 'Add admin', ShieldCheck],
    ] as const).map(([key, label, Icon]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={16} />{label}{key === 'support' && supportChats.some((chat) => chat.unreadForAdmin > 0) && <i />}</button>)}</nav>

    {tab === 'overview' && <section className="admin-section">
      <div className="admin-stat-grid">
        <StatCard icon={Users} label="Registered users" value={stats?.users ?? '—'} detail={`${stats?.transactions ?? 0} total transactions`} />
        <StatCard icon={WalletCards} label="Wallets held" value={naira(stats?.totalWalletBalance)} detail="Across all accounts" tone="purple" />
        <StatCard icon={AlertTriangle} label="Needs attention" value={(stats?.pendingTransactions ?? 0) + deposits.length + kycRows.length} detail={`${stats?.pendingWithdrawals ?? 0} pending withdrawals`} tone="red" />
        <StatCard icon={CircleDollarSign} label="Tracked income" value={naira(stats?.totalIncome)} detail={`${naira(stats?.totalVasProfit)} VAS margin`} tone="green" />
      </div>
      <div className="admin-grid-two">
        <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Broadcast desk</span><h2>Reach your users</h2><p>Send an in-app notice to a chosen audience, with optional email delivery.</p></div><Send size={19} /></div><form className="cp-form admin-form" onSubmit={broadcastNotice}><label className="cp-field"><span>Title</span><input value={broadcast.title} onChange={(event) => setBroadcast({ ...broadcast, title: event.target.value })} required placeholder="Scheduled maintenance" /></label><label className="cp-field"><span>Message</span><textarea value={broadcast.body} onChange={(event) => setBroadcast({ ...broadcast, body: event.target.value })} required placeholder="Write the message users should see." /></label><div className="admin-form-row"><label className="cp-field"><span>Audience</span><select value={broadcast.filter} onChange={(event) => setBroadcast({ ...broadcast, filter: event.target.value })}><option value="all">Everyone</option><option value="verified">Verified users</option><option value="active">Users with wallet balance</option></select></label><label className="admin-check"><input type="checkbox" checked={broadcast.email} onChange={(event) => setBroadcast({ ...broadcast, email: event.target.checked })} /> Also email them</label></div><AdminButton variant="primary" disabled={broadcasting}>{broadcasting ? 'Broadcasting…' : 'Send broadcast'} <Send size={15} /></AdminButton></form></section>
        <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Queues at a glance</span><h2>What needs you now</h2><p>Jump straight into the highest-impact work.</p></div><Zap size={19} /></div><div className="admin-queue-list"><button type="button" onClick={() => setTab('support')}><LifeBuoy size={17} /><span><b>{supportChats.length} open support conversations</b><small>Join the oldest request first</small></span><ChevronRight size={16} /></button><button type="button" onClick={() => setTab('verification')}><ClipboardCheck size={17} /><span><b>{kycRows.length} KYC submissions</b><small>Review identity documents</small></span><ChevronRight size={16} /></button><button type="button" onClick={() => setTab('money')}><CreditCard size={17} /><span><b>{deposits.length} deposits waiting</b><small>Confirm or decline funding</small></span><ChevronRight size={16} /></button><button type="button" onClick={() => setTab('activity')}><Flag size={17} /><span><b>{stats?.flaggedTransactions ?? 0} flagged transactions</b><small>Inspect unusual activity</small></span><ChevronRight size={16} /></button></div></section>
      </div>
      <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Infrastructure</span><h2>Runtime diagnostics</h2><p>Check the outbound address used for provider allowlists.</p></div><button type="button" className="admin-btn admin-btn-soft" onClick={async () => { try { const result = await adminRequest<any>('/api/admin/egress-ip', token); setEgressIp(result.ip); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not check egress IP.'); } }}>Check egress IP</button></div>{egressIp && <div className="admin-code-value">{egressIp}</div>}</section>
    </section>}

       {tab === 'admins' && <section className="admin-section"><div className="admin-grid-two"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Team access</span><h2>Current admins</h2><p>{admins.length} account{admins.length === 1 ? '' : 's'} can access the admin console.</p></div><ShieldCheck size={20} /></div><div className="admin-list">{admins.map((admin) => <div className="admin-list-row" key={admin.id}><div><b>{[admin.firstName, admin.lastName].filter(Boolean).join(' ') || 'CipherPay Admin'}</b><small>{admin.email}{admin.isMaster ? ' · Master admin' : admin.id === currentAdminId ? ' · You' : ''}</small></div><div className="admin-list-actions"><span className={statusClass(admin.isSuspended ? 'suspended' : 'active')}>{admin.isSuspended ? 'Suspended' : 'Active'}</span>{admin.isMaster ? <span className="admin-protected-label">Protected</span> : admin.id === currentAdminId ? <span className="admin-protected-label">Current session</span> : <AdminButton variant="danger" onClick={() => void removeAdmin(admin)}><Trash2 size={13} /> Remove</AdminButton>}</div></div>)}{!admins.length && <div className="admin-empty"><Users size={22} />No admin accounts found.</div>}</div></section><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Team access</span><h2>Create another admin</h2><p>New admins can sign in with their own email and password and review the same operations console.</p></div><UserCheck size={20} /></div><form className="cp-form admin-form" onSubmit={createAdmin}><div className="admin-form-row"><label className="cp-field"><span>Admin email</span><input type="email" value={newAdmin.email} onChange={(event) => setNewAdmin({ ...newAdmin, email: event.target.value })} required placeholder="operator@example.com" /></label><label className="cp-field"><span>Password</span><input type="password" value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} required minLength={8} placeholder="At least 8 characters" /></label></div><AdminButton variant="primary" disabled={creatingAdmin}>{creatingAdmin ? 'Creating…' : 'Create admin'} <UserCheck size={15} /></AdminButton></form></section></div></section>}
     {tab === 'users' && <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Account control</span><h2>Every registered user</h2><p>Suspend, verify, message, adjust wallets, clear PINs, reset activity, or remove accounts.</p></div><Users size={20} /></div><form className="admin-search" onSubmit={searchUsers}><Search size={17} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search name, email, or phone" /><button type="submit">Search</button></form><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Status</th><th>Wallet</th><th>Joined</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="admin-user-cell"><span className="admin-avatar">{String(user.firstName?.[0] ?? '')}{String(user.lastName?.[0] ?? '')}</span><span><b>{user.firstName} {user.lastName}</b><small>{user.email}<br />{user.phone}</small></span></div></td><td><span className={statusClass(user.isSuspended ? 'suspended' : user.isVerified ? 'verified' : 'unverified')}>{user.isSuspended ? 'Suspended' : user.isVerified ? 'Verified' : 'Unverified'}</span><small className="admin-muted">KYC L{user.kycLevel ?? 0}</small></td><td><b>{naira(user.balance)}</b></td><td><small>{formatWhen(user.createdAt)}</small></td><td><div className="admin-action-grid"><AdminButton onClick={() => void userAction(user, 'adjust')}>Adjust wallet</AdminButton><AdminButton onClick={() => void userAction(user, 'set-balance')}>Set balance</AdminButton><AdminButton onClick={() => void userAction(user, 'debit-to-admin')}>Debit → admin</AdminButton><AdminButton onClick={() => void userAction(user, 'kyc')}>Set KYC</AdminButton><AdminButton onClick={() => void userAction(user, 'notify')}><MessageCircle size={13} /> Notify</AdminButton><AdminButton onClick={() => void userAction(user, 'email')}><Mail size={13} /> Email</AdminButton><AdminButton onClick={() => void userAction(user, 'suspend')} variant={user.isSuspended ? 'primary' : 'soft'}>{user.isSuspended ? <><UserCheck size={13} /> Restore</> : <><Ban size={13} /> Suspend</>}</AdminButton><AdminButton onClick={() => void userAction(user, 'verify')}><Check size={13} /> {user.isVerified ? 'Unverify' : 'Verify'}</AdminButton><AdminButton onClick={() => void userAction(user, 'pin')}><ShieldCheck size={13} /> Clear PIN</AdminButton><AdminButton onClick={() => void userAction(user, 'activity')} variant="danger"><RefreshCw size={13} /> Reset activity</AdminButton><AdminButton onClick={() => void userAction(user, 'delete')} variant="danger"><Trash2 size={13} /> Delete</AdminButton></div></td></tr>)}</tbody></table>{!users.length && <div className="admin-empty"><Users size={22} />No users match this search.</div>}</div></section></section>}

    {tab === 'support' && <section className="admin-section admin-support-grid"><section className="cp-card admin-chat-list"><div className="admin-panel-head"><div><span className="cp-kicker">Support records</span><h2>{supportFilter === 'closed' ? 'Conversation history' : 'Support inbox'}</h2><p>{supportFilter === 'closed' ? 'Ended conversations grouped by customer.' : 'Every request from the customer support desk.'}</p></div><AdminButton onClick={() => void loadAll()}><RefreshCw size={14} /></AdminButton></div><div className="admin-support-filters">{(['open', 'closed', 'all'] as const).map((filter) => <button type="button" key={filter} className={supportFilter === filter ? 'active' : ''} onClick={() => { setSelectedSupport(null); setSupportFilter(filter); }}>{filter === 'open' ? 'Open now' : filter === 'closed' ? 'History' : 'All records'}</button>)}</div>{supportChats.length ? supportGroups.map((group) => <div key={group.label}><div className="admin-support-user-heading"><span><Users size={13} />{group.label}</span><small>{group.chats.length} conversation{group.chats.length === 1 ? '' : 's'}</small></div>{group.chats.map((chat) => <button type="button" className={`admin-chat-row ${selectedSupport?.chat?.id === chat.id ? 'active' : ''}`} key={chat.id} onClick={() => void openSupport(chat.id)}><span className={`admin-chat-dot ${chat.status}`} /><span><b>Conversation #{chat.id}</b><small>{chat.userEmail} · {chat.status} · {formatWhen(chat.lastMessageAt)}</small></span>{chat.unreadForAdmin > 0 && <strong>{chat.unreadForAdmin}</strong>}<ChevronRight size={15} /></button>)}</div>) : <div className="admin-empty"><LifeBuoy size={22} />{supportFilter === 'closed' ? 'No ended support conversations.' : 'No open support requests.'}</div>}</section><section className="cp-card admin-chat-detail">{selectedSupport ? <><div className="admin-panel-head"><div><span className="cp-kicker">Conversation #{selectedSupport.chat.id}</span><h2>{selectedSupport.user?.firstName} {selectedSupport.user?.lastName}</h2><p>{selectedSupport.user?.email} · KYC L{selectedSupport.user?.kycLevel ?? 0} · {selectedSupport.user?.isSuspended ? 'Suspended' : 'Active'}</p></div><div className="admin-actions">{selectedSupport.chat.status !== 'live' && selectedSupport.chat.status !== 'closed' && <AdminButton variant="primary" onClick={() => void supportAction('join')}><Headphones size={14} /> Join chat</AdminButton>}{selectedSupport.chat.status !== 'closed' && <AdminButton onClick={() => void supportAction('close')}><Check size={14} /> Close</AdminButton>}</div></div><div className="admin-chat-messages">{(selectedSupport.messages ?? []).map((message: any) => <div className={`admin-message ${message.sender === 'agent' ? 'agent' : message.sender === 'user' ? 'user' : 'system'}`} key={message.id}><small>{message.sender === 'agent' ? 'You / Support' : message.sender === 'user' ? 'Customer' : 'System'} · {formatWhen(message.createdAt)}</small><p>{message.imageUrl && <img src={message.imageUrl} alt="Attachment from support conversation" />}{message.body !== '📷 Image' && message.body}</p></div>)}</div>{selectedSupport.chat.status !== 'closed' && <form className="admin-chat-compose" onSubmit={sendSupportMessage}><input ref={supportImageRef} className="admin-sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSupportImage(file); }} /><button className="admin-chat-attach" type="button" onClick={() => supportImageRef.current?.click()} disabled={supportUploading}><Paperclip size={16} /></button><input value={supportDraft} onChange={(event) => { setSupportDraft(event.target.value); void adminRequest(`/api/admin/support/chats/${selectedSupport.chat.id}/typing`, token, { method: 'POST' }); }} placeholder={supportUploading ? 'Uploading image…' : 'Reply as Support…'} /><button type="submit" disabled={!supportDraft.trim() || supportUploading}><Send size={16} /></button></form>}</> : <div className="admin-detail-empty"><MessageCircle size={25} /><b>Select a support request</b><span>Messages, customer details, and live controls will appear here.</span></div>}</section></section>}


    {tab === 'verification' && <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Compliance queue</span><h2>Identity review</h2><p>Approve or reject submitted verification records and keep limits current.</p></div><ClipboardCheck size={20} /></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Verification</th><th>Document</th><th>Submitted</th><th>Review</th></tr></thead><tbody>{kycRows.map((row) => { const level = row.level || (row.verificationType === 'basic' ? 1 : 2); return <tr key={row.id}><td><b>{row.userFirst} {row.userLast}</b><small>{row.userEmail}<br />{row.userPhone}</small></td><td><b>{row.verificationType === 'basic' ? 'Basic' : 'Advanced'}</b><small>Level {level}</small></td><td><b>{row.documentType}</b><small>{row.documentNumber}</small></td><td><small>{formatWhen(row.submittedAt)}</small></td><td><div className="admin-actions"><AdminButton variant="primary" onClick={() => void run(`/api/admin/kyc/${row.id}/approve`, { method: 'POST', body: { level } }, 'KYC approved.')}>Approve L{level}</AdminButton><AdminButton variant="danger" onClick={async () => { const reason = await prompt({ title: 'Reject this verification', defaultValue: 'Please submit a clearer document image.', placeholder: 'Reason for rejection', confirmLabel: 'Reject verification', destructive: true }); if (reason) void run(`/api/admin/kyc/${row.id}/reject`, { method: 'POST', body: { reason } }, 'KYC rejected.'); }}>Reject</AdminButton></div></td></tr>; })}</tbody></table>{!kycRows.length && <div className="admin-empty">No KYC submissions waiting for review.</div>}</div></section></section>}

    {tab === 'activity' && <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Ledger watch</span><h2>Recent transactions</h2><p>Flag suspicious activity, complete pending items, or issue a controlled refund.</p></div><Flag size={19} /></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Transaction</th><th>User</th><th>Amount</th><th>Status</th><th>Controls</th></tr></thead><tbody>{visibleTransactions.map((tx) => <tr key={tx.id}><td><b>#{tx.id} · {tx.type}</b><small>{tx.reference}<br />{formatWhen(tx.createdAt)}</small></td><td><small>{tx.userName || tx.userEmail}</small></td><td><b>{naira(tx.amount)}</b></td><td><span className={statusClass(tx.isFlagged ? 'flagged' : tx.status)}>{tx.isFlagged ? 'Flagged' : tx.status}</span></td><td><div className="admin-actions"><AdminButton onClick={() => void run(`/api/admin/transactions/${tx.id}/flag`, { method: 'POST', body: { flagged: !tx.isFlagged, reason: tx.isFlagged ? null : 'Flagged for admin review' } }, tx.isFlagged ? 'Flag removed.' : 'Transaction flagged.')}>{tx.isFlagged ? 'Unflag' : 'Flag'}</AdminButton>{tx.status === 'pending' && <><AdminButton variant="primary" onClick={() => void run(`/api/admin/transactions/${tx.id}/mark-success`, { method: 'POST' }, 'Transaction marked successful.')}>Mark success</AdminButton><AdminButton variant="danger" onClick={async () => { const reason = await prompt({ title: 'Refund this transaction', defaultValue: 'Reviewed and refunded by admin', placeholder: 'Refund reason', confirmLabel: 'Refund transaction', destructive: true }); if (reason) void run(`/api/admin/transactions/${tx.id}/mark-failed-refund`, { method: 'POST', body: { reason } }, 'Transaction failed and refunded.'); }}>Refund</AdminButton></>}</div></td></tr>)}</tbody></table></div></section><div className="admin-grid-two"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">SMS activity</span><h2>Recent activations</h2></div><Smartphone size={19} /></div><div className="admin-mini-list">{smsActivations.slice(0, 12).map((row) => <div key={row.id}><span><b>{row.userEmail}</b><small>{row.phoneNumber || row.number} · {row.service}</small></span><span className={statusClass(row.status)}>{row.status}</span></div>)}{!smsActivations.length && <div className="admin-empty">No SMS activations.</div>}</div></section><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Social fulfilment</span><h2>Recent social orders</h2></div><Zap size={19} /></div><div className="admin-mini-list">{socialOrders.slice(0, 12).map((row) => <div key={row.id}><span><b>{row.userEmail}</b><small>{row.service} · {row.reference}</small></span><span className={statusClass(row.status)}>{row.status}</span></div>)}{!socialOrders.length && <div className="admin-empty">No social orders.</div>}</div></section></div><section className="cp-card cp-card-pad admin-danger-zone"><div className="admin-card-title"><div><span className="cp-kicker">Restricted system actions</span><h2>Break-glass controls</h2><p>These actions permanently remove data. They are intentionally separate from routine operations and require a second confirmation.</p></div><AlertTriangle size={20} /></div><div className="admin-danger-actions"><AdminButton variant="danger" onClick={async () => { if (!await confirm({ title: 'Reset the entire system?', description: 'This will wipe every non-admin account, wallet, transaction, support chat, KYC record, and notification.', confirmLabel: 'Continue to reset', destructive: true })) return; const phrase = await prompt({ title: 'Confirm system reset', description: 'Type RESET_CIPHERPAY_SYSTEM exactly to continue.', placeholder: 'RESET_CIPHERPAY_SYSTEM', confirmLabel: 'Reset system', destructive: true }); if (phrase === 'RESET_CIPHERPAY_SYSTEM') void run('/api/admin/system/reset', { method: 'POST', headers: { 'x-reset-confirm': phrase } }, 'System reset completed. Admin data was preserved.'); }}>Reset entire system</AdminButton><AdminButton variant="danger" onClick={async () => { if (await confirm({ title: 'Purge completed withdrawals?', description: 'All successful and failed withdrawal records will be deleted. This cannot be undone.', confirmLabel: 'Purge withdrawals', destructive: true })) void run('/api/admin/withdrawals', { method: 'DELETE' }, 'Completed withdrawal records purged.'); }}>Purge completed withdrawals</AdminButton></div></section></section>}
  </main>;
}