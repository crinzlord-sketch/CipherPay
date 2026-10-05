import {
  AlertTriangle, ArrowDownLeft, Ban, Check, CheckCircle2, ChevronRight, CircleDollarSign,
  ClipboardCheck, CreditCard, Database, FileText, Flag, Headphones, LifeBuoy,
  Image as ImageIcon, Mail, MessageCircle, Paperclip, RefreshCw, Search, Send, ShieldCheck, Smartphone,
  Trash2, UserCheck, Users, WalletCards, X, Zap, Activity, PackagePlus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAnimatedDialog } from '../components/animated-dialog';
import { apiUrl, formatWhen } from './page-api';
import './admin.css';
import UserDetailView from './UserDetailView';
import { avatarDataUrl } from '../components/CipherAvatar';
import AdminSocialAccounts from './AdminSocialAccounts';

type Tab = 'overview' | 'users' | 'admins' | 'support' | 'money' | 'verification' | 'activity' | 'services' | 'social-accounts' | 'sellers' | 'gift-cards';
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

function formatLagosWhen(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date) + ' WAT';
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

function AdminAvatar({ user, large = false }: { user: any; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const className = large ? 'admin-avatar admin-avatar-large' : 'admin-avatar';
  const rawSrc = typeof user?.avatarUrl === 'string' ? user.avatarUrl.trim() : '';
  const src = rawSrc
    ? (rawSrc.startsWith('data:') || rawSrc.startsWith('http://') || rawSrc.startsWith('https://')
      ? rawSrc
      : apiUrl(rawSrc.startsWith('/') ? rawSrc : `/${rawSrc}`))
    : '';
  const fallback = avatarDataUrl(user?.id ?? user?.email ?? 'cipherpay-user', user?.gender);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return <img
    className={`${className} admin-avatar-image`}
    src={src && !failed ? src : fallback}
    alt=""
    onError={() => setFailed(true)}
  />;
}

function StatCard({ icon: Icon, label, value, detail, tone = 'orange' }: { icon: typeof Users; label: string; value: string | number; detail?: string; tone?: string }) {
  return <div className={`admin-stat admin-stat-${tone}`}><span className="admin-stat-icon"><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div></div>;
}


function AdminGiftCards({ token, onNotice, onError, prompt }: { token: string; onNotice: (message: string) => void; onError: (message: string) => void; prompt: any }) {\n  const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(true);\n  const load=useCallback(async()=>{ if(!token)return; setLoading(true); try{ const result=await adminRequest<any>('/api/admin/gift-card-orders',token); setRows(result.data??[]); onError(''); }catch(e){onError(e instanceof Error?e.message:'Gift card orders could not be loaded.');}finally{setLoading(false);} },[token,onError]);\n  useEffect(()=>{void load();},[load]);\n  const complete=async(row:any)=>{ const raw=await prompt({title:'Complete gift card payout',description:row.payoutDestination==='bank'?'Confirm that you have sent the money to the bank account shown below.':'Confirm that the payout should be credited to the user wallet.',defaultValue:String(Number(row.netPayout??0).toFixed(2)),placeholder:'Net payout in NGN',confirmLabel:'Mark completed'}); if(raw===null)return; const amount=Number(String(raw).replace(/,/g,'')); if(!Number.isFinite(amount)||amount<=0){onError('Enter a valid payout amount.');return;} try{await adminRequest('/api/admin/gift-card-orders/'+row.id+'/complete',token,{method:'POST',body:{netPayout:amount}});onNotice('Gift card payout marked completed.');await load();}catch(e){onError(e instanceof Error?e.message:'Could not complete the payout.');} };\n  const reject=async(row:any)=>{const reason=await prompt({title:'Reject gift card payout',defaultValue:'Gift card payout rejected after admin review.',placeholder:'Reason',confirmLabel:'Reject',destructive:true});if(!reason)return;try{await adminRequest('/api/admin/gift-card-orders/'+row.id+'/reject',token,{method:'POST',body:{reason}});onNotice('Gift card order rejected.');await load();}catch(e){onError(e instanceof Error?e.message:'Could not reject the order.');}};\n  return <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">GIFT CARD PAYOUT DESK</span><h2>Gift card redemptions</h2><p>Verified cards stay here until an admin prepares the user's payout. Target turnaround is 10 minutes.</p></div><AdminButton onClick={()=>void load()} disabled={loading}><RefreshCw size={15} className={loading?'admin-spin':''}/> Refresh</AdminButton></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Card</th><th>Verified value</th><th>Fee</th><th>User receives</th><th>Destination</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><b>{row.userFirst} {row.userLast}</b><small>{row.userEmail} · User #{row.userId}</small></td><td><b>{row.productName}</b><small>{row.currencyCode} · {row.countryCode}<br/>{row.sogoReference||'No provider reference'}</small></td><td><b>{naira(row.payoutAmount)}</b></td><td><small>{naira(row.fee)}</small></td><td><b>{naira(row.netPayout)}</b></td><td><small>{row.payoutDestination==='bank'?((row.payoutAccount?.bankName||'Bank')+' · '+(row.payoutAccount?.accountNumber||'')):'CipherPay wallet'}</small></td><td><span className={statusClass(row.status)}>{row.status}</span></td><td><div className="admin-actions">{['processing','verified'].includes(row.status)&&<><AdminButton variant="primary" onClick={()=>void complete(row)}>Mark completed</AdminButton><AdminButton variant="danger" onClick={()=>void reject(row)}>Reject</AdminButton></>}{row.status==='completed'&&<span className="admin-protected-label">Completed</span>}</div></td></tr>)}</tbody></table>{!rows.length&&!loading&&<div className="admin-empty"><Gift size={22}/>No gift card payouts waiting.</div>}{loading&&<div className="admin-empty"><RefreshCw size={22} className="admin-spin"/>Loading gift card orders…</div>}</div></section></section>;\n}\n\nfunction AdminSellers({ token, onNotice, onError }: { token: string; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSellers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await adminRequest<any>('/api/admin/sellers', token);
      setRows(Array.isArray(result.data) ? result.data : []);
      onError('');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'The sellers could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => { void loadSellers(); }, [loadSellers]);

  return <section className="admin-section">
    <section className="cp-card cp-card-pad">
      <div className="admin-card-title">
        <div><span className="cp-kicker">Seller accounts</span><h2>Approved sellers</h2><p>Manage users who have been approved to operate as sellers.</p></div>
        <AdminButton onClick={() => void loadSellers()} disabled={loading}><RefreshCw size={15} className={loading ? 'admin-spin' : ''} /> Refresh</AdminButton>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Seller</th><th>Country</th><th>Approved</th><th>Application IP</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.userId}>
              <td><b>{row.sellerName || 'Unnamed seller'}</b><small>{row.email} · User #{row.userId}</small></td>
              <td><small>{row.country || '—'}</small></td>
              <td><small>{formatWhen(row.approvedAt)}</small></td>
              <td><small className="admin-mono">{row.applicationIp || '—'}</small></td>
            </tr>)}
          </tbody>
        </table>
        {!loading && !rows.length && <div className="admin-empty"><ShieldCheck size={22} />No approved sellers yet.</div>}
        {loading && <div className="admin-empty"><RefreshCw size={22} className="admin-spin" />Loading sellers…</div>}
      </div>
    </section>
  </section>;
}

export default function AdminConsole() {
  const { confirm, prompt } = useAnimatedDialog();
  const [token, setToken] = useState(() => typeof window === 'undefined' ? '' : localStorage.getItem('cipherpay_token') ?? '');
  const [tab, setTab] = useState<Tab>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'support' ? 'support' : 'overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adminAlertCounts, setAdminAlertCounts] = useState({ verification: 0, support: 0, sellers: 0, giftCards: 0 });
  const [serviceFeatures, setServiceFeatures] = useState<any[]>([]);
  const [serviceUpdating, setServiceUpdating] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserDetails, setSelectedUserDetails] = useState<any>(null);
  const [userDetailsLoading, setUserDetailsLoading] = useState(false);
  const [admins, setAdmins] = useState<any[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState<number | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [transactionStatusFilter, setTransactionStatusFilter] = useState('all');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('all');
  const [transactionLastUpdated, setTransactionLastUpdated] = useState<string | null>(null);
  const [supportChats, setSupportChats] = useState<any[]>([]);
  const [supportFilter, setSupportFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [selectedSupport, setSelectedSupport] = useState<any>(null);
  const [kycRows, setKycRows] = useState<any[]>([]);
  const [selectedKyc, setSelectedKyc] = useState<any>(null);
  const [kycIdentityCheck, setKycIdentityCheck] = useState<any>(null);
  const [checkingKycIdentity, setCheckingKycIdentity] = useState(false);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [smsActivations, setSmsActivations] = useState<any[]>([]);
  const [socialOrders, setSocialOrders] = useState<any[]>([]);
  const [egressIp, setEgressIp] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
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
  const [detailAction, setDetailAction] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [meResult, statsResult, usersResult, transactionsResult, supportResult, kycResult, depositsResult, withdrawalsResult, smsResult, socialResult, adminsResult, alertsResult, serviceFeaturesResult] = await Promise.all([
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
        adminRequest<any>('/api/admin/alerts', token),
        adminRequest<any>('/api/admin/service-features', token),
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
      setAdminAlertCounts({ verification: Number(alertsResult.verification ?? 0), support: Number(alertsResult.support ?? 0), sellers: Number(alertsResult.sellers ?? 0), giftCards: Number(alertsResult.giftCards ?? 0) });
      setServiceFeatures(serviceFeaturesResult.data ?? []);
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

  // Opening a queue tab marks its admin alerts as seen. New submissions that
  // arrive afterwards create a fresh unread badge.
  useEffect(() => {
    if (!token || !['verification', 'support', 'sellers', 'gift-cards'].includes(tab)) return;
    const type = tab === 'verification' ? 'admin_kyc' : tab === 'support' ? 'admin_support' : tab === 'sellers' ? 'admin_seller' : 'admin_gift_card';
    void adminRequest('/api/admin/alerts/read', token, { method: 'POST', body: { type } })
      .then(() => setAdminAlertCounts((current) => ({ ...current, [tab === 'gift-cards' ? 'giftCards' : tab]: 0 })))
      .catch(() => {});
  }, [tab, token]);

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

  const toggleServiceFeature = async (feature: any) => {
    if (!token || serviceUpdating) return;
    setServiceUpdating(feature.key);
    setError('');
    setNotice('');
    try {
      const result = await adminRequest<any>(`/api/admin/service-features/${encodeURIComponent(feature.key)}`, token, {
        method: 'PUT',
        body: { enabled: !feature.enabled },
      });
      setServiceFeatures((current) => current.map((item) => item.key === feature.key ? result.feature : item));
      setNotice(result.feature.enabled ? `${result.feature.label} is back online.` : `${result.feature.label} is now in maintenance mode.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The service availability could not be updated.');
    } finally {
      setServiceUpdating(null);
    }
  };

  const testAdminEmail = async () => {
    if (!token || testingEmail) return;
    setTestingEmail(true);
    setError('');
    setNotice('');
    try {
      const result = await adminRequest<any>('/api/admin/email/test', token, { method: 'POST' });
      setNotice(`Live test email sent to ${result.recipient}. Check the inbox and spam folder.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The test email could not be sent.');
    } finally {
      setTestingEmail(false);
    }
  };

  const openUserDetails = async (user: any) => {
    if (!token) return;
    setUserDetailsLoading(true);
    setError('');
    try {
      const result = await adminRequest<any>(`/api/admin/users/${user.id}/details`, token);
      setSelectedUserDetails(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The user details could not be loaded.');
    } finally {
      setUserDetailsLoading(false);
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

  const searchTransactions = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const reference = referenceQuery.trim();
    if (!reference) {
      await loadAll();
      return;
    }
    try {
      const result = await adminRequest<any>(`/api/admin/transactions?limit=100&reference=${encodeURIComponent(reference)}`, token);
      setTransactions(result.data ?? []);
      setTab('money');
      setError('');
      if (!(result.data ?? []).length) setNotice('No transaction matched that reference.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Transactions could not be searched.');
    }
  };

  const openUserDetail = async (user: any) => {
    if (!token) return;
    setUserDetailLoading(true);
    setError('');
    try {
      const result = await adminRequest<any>(`/api/admin/users/${user.id}/details`, token);
      setSelectedUser(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this user profile.');
    } finally {
      setUserDetailLoading(false);
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
      if (!await confirm({ title: 'Clear transaction PIN?', description: 'The user will need to set a new transaction PIN before making transfers or payments.', confirmLabel: 'Clear PIN', destructive: true })) return;
      await run(`/api/admin/users/${user.id}/pin-clear`, { method: 'POST', body: { reason: 'Cleared by support from admin console' } }, 'Transaction PIN cleared.');
    }
    if (action === 'adjust') { setDetailAction({ kind: 'wallet', mode: 'adjust', user }); return; }
    if (action === 'set-balance') {
      const raw = await prompt({ title: 'Set wallet balance', description: 'Enter the exact wallet balance in NGN.', defaultValue: formatGroupedNumber(user.balance ?? 0), placeholder: 'Wallet balance', confirmLabel: 'Continue', format: 'grouped-number' });
      if (raw === null) return;
      const balance = Number(raw.replace(/,/g, ''));
      const reason = await prompt({ title: 'Add an audit reason', defaultValue: 'Balance correction', placeholder: 'Required audit reason', confirmLabel: 'Set balance' });
      if (reason === null) return;
      await run(`/api/admin/users/${user.id}/wallet-set`, { method: 'POST', body: { balance, reason } }, 'Wallet balance set.');
    }
    if (action === 'debit-to-admin') { setDetailAction({ kind: 'wallet', mode: 'debit-to-admin', user }); return; }
    if (action === 'kyc') {
      const raw = await prompt({ title: 'Set KYC level', description: 'Choose a level from 0 to 3.', defaultValue: String(user.kycLevel ?? 0), placeholder: '0, 1, 2, or 3', confirmLabel: 'Set level' });
      if (raw === null) return;
      const level = Number(raw);
      await run(`/api/admin/users/${user.id}/set-kyc`, { method: 'POST', body: { level } }, `KYC level set to L${level}.`);
    }
    if (action === 'kyc-verify') {
      const verified = Number(user.kycLevel ?? 0) > 0;
      await run(
        `/api/admin/users/${user.id}/set-kyc-verified`,
        { method: 'POST', body: { verified: !verified } },
        !verified ? 'User KYC marked as verified.' : 'User KYC verification removed.',
      );
    }
    if (action === 'credit') { setDetailAction({ kind: 'wallet', mode: 'credit', user }); return; }
    if (action === 'debit') { setDetailAction({ kind: 'wallet', mode: 'debit', user }); return; }
    if (action === 'notify') {
      const title = await prompt({ title: 'Notification title', defaultValue: 'Message from CipherPay', placeholder: 'Title', confirmLabel: 'Continue' });
      if (!title) return;
      const body = await prompt({ title: 'Notification message', placeholder: 'Write the message', confirmLabel: 'Send notification' });
      if (!body) return;
      await run(`/api/admin/users/${user.id}/notify`, { method: 'POST', body: { title, body, email: false } }, 'Notification sent.');
    }
    if (action === 'email') { setDetailAction({ kind: 'email', user }); return; }
    if (action === 'activity') {
      if (!await confirm({ title: 'Reset this user’s activity?', description: 'This removes their transactions, purchases, and notifications. Their wallet balance will not be affected. This cannot be undone.', confirmLabel: 'Reset activity', destructive: true })) return;
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

  const openKyc = (row: any) => {
    setSelectedKyc(row);
    setKycIdentityCheck(null);
  };

  const checkKycIdentity = async () => {
    if (!selectedKyc || !token) return;
    setCheckingKycIdentity(true);
    setError('');
    try {
      const result = await adminRequest<any>(`/api/admin/kyc/${selectedKyc.id}/identity-check`, token, { method: 'POST' });
      setKycIdentityCheck(result);
    } catch (caught) {
      setKycIdentityCheck({ error: caught instanceof Error ? caught.message : 'Identity check failed.' });
    } finally {
      setCheckingKycIdentity(false);
    }
  };


  const filteredTransactions = useMemo(() => transactions.filter((row: any) => (transactionStatusFilter === 'all' || row.status === transactionStatusFilter) && (transactionTypeFilter === 'all' || row.type === transactionTypeFilter)), [transactions, transactionStatusFilter, transactionTypeFilter]);

  const refreshTransactions = useCallback(async () => {
    if (!token) return;
    try {
      const query = new URLSearchParams({ limit: '200' });
      if (transactionStatusFilter !== 'all') query.set('status', transactionStatusFilter);
      if (transactionTypeFilter !== 'all') query.set('type', transactionTypeFilter);
      const result = await adminRequest<any>(`/api/admin/transactions?${query.toString()}`, token);
      setTransactions(result.data ?? []);
      setTransactionLastUpdated(new Date().toISOString());
    } catch {}
  }, [token, transactionStatusFilter, transactionTypeFilter]);

  useEffect(() => {
    if (!token || tab !== 'money') return;
    void refreshTransactions();
    const timer = window.setInterval(() => void refreshTransactions(), 5000);
    return () => window.clearInterval(timer);
  }, [token, tab, refreshTransactions]);


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


  const submitDetailAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailAction || !token) return;
    const d = detailAction;
    if (d.kind === 'email') {
      const subject = String(d.subject || '').trim();
      const message = [d.greeting, d.message, d.closing].map((v:any)=>String(v||'').trim()).filter(Boolean).join('\n\n');
      if (!subject || !d.message?.trim()) { setError('Subject and message are required.'); return; }
      const result = await run('/api/admin/users/' + d.user.id + '/send-email', { method:'POST', body:{subject, message} }, 'Detailed email sent.');
      if (result) setDetailAction(null);
      return;
    }
    const amount = Number(String(d.amount || '').replace(/,/g,''));
    const reason = String(d.reason || '').trim();
    if (!(amount > 0) || !reason) { setError('Enter a valid amount and a reason.'); return; }
    let result:any = null;
    if (d.mode === 'credit') result = await run('/api/admin/users/' + d.user.id + '/credit', {method:'POST',body:{amount,reason}}, 'User wallet credited.');
    else if (d.mode === 'debit') result = await run('/api/admin/users/' + d.user.id + '/debit', {method:'POST',body:{amount,reason}}, 'User wallet debited.');
    else if (d.mode === 'debit-to-admin') result = await run('/api/admin/users/' + d.user.id + '/debit-to-admin', {method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:{amount,description:reason}}, 'Funds moved to admin wallet.');
    else result = await run('/api/admin/users/' + d.user.id + '/wallet-adjust', {method:'POST',body:{amount:d.direction === 'debit' ? -amount : amount,reason}}, 'Wallet adjusted.');
    if (result) setDetailAction(null);
  };

  if (!token) {
    return <main className="cp-page admin-console"><section className="cp-card cp-card-pad admin-unlock"><div className="admin-unlock-icon"><ShieldCheck size={24} /></div><h2>Admin session unavailable</h2><p>Your normal CipherPay admin sign-in is no longer active. Sign in again to continue.</p>{error && <div className="cp-notice cp-notice-error">{error}</div>}<button className="admin-btn admin-btn-primary" type="button" onClick={() => { localStorage.removeItem('cipherpay_token'); window.location.href = '/login'; }}>Back to sign in <ChevronRight size={16} /></button></section></main>;
  }

  return <main className="cp-page admin-console cp-page-reveal">

  {detailAction && <div className="admin-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setDetailAction(null)}}><form className="cp-card cp-card-pad admin-detail-modal" onSubmit={submitDetailAction}>
    <div className="admin-panel-head"><div><span className="cp-kicker">{detailAction.kind==='transaction'?'TRANSACTION DETAILS':detailAction.kind==='email'?'USER COMMUNICATION':'WALLET ACTION'}</span><h2>{detailAction.kind==='transaction'?'Transaction activity':detailAction.kind==='email'?'Detailed email':'Wallet action'}</h2><p>{detailAction.kind==='transaction' ? `${detailAction.transaction.userName || 'Customer'} · ${detailAction.transaction.userEmail || 'No email'} · User #${detailAction.transaction.userId}` : `${detailAction.user.email} · Current balance ${naira(detailAction.user.balance)}`}</p></div><AdminButton onClick={()=>setDetailAction(null)}><X size={15}/></AdminButton></div>
    {detailAction.kind==='transaction' ? <div className="admin-transaction-detail">
      <div className="admin-transaction-detail-hero"><span className={statusClass(detailAction.transaction.isFlagged ? 'flagged' : detailAction.transaction.status)}>{detailAction.transaction.isFlagged ? 'Flagged' : detailAction.transaction.status}</span><strong>{naira(detailAction.transaction.amount)}</strong><small>{formatLagosWhen(detailAction.transaction.createdAt)}</small></div>
      <div className="admin-detail-facts">
        <span><small>Reference</small><b className="admin-mono">{detailAction.transaction.reference || '—'}</b></span>
        <span><small>Transaction ID</small><b>#{detailAction.transaction.id}</b></span>
        <span><small>Type</small><b>{String(detailAction.transaction.type || '—').replaceAll('_',' ')}</b></span>
        <span><small>Fee</small><b>{naira(detailAction.transaction.fee)}</b></span>
        <span><small>Balance before</small><b>{detailAction.transaction.balanceBefore == null ? '—' : naira(detailAction.transaction.balanceBefore)}</b></span>
        <span><small>Balance after</small><b>{detailAction.transaction.balanceAfter == null ? '—' : naira(detailAction.transaction.balanceAfter)}</b></span>
        <span><small>Customer</small><b>{detailAction.transaction.userName || '—'}</b></span>
        <span><small>Customer email</small><b>{detailAction.transaction.userEmail || '—'}</b></span>
        <span><small>Created · Lagos</small><b>{formatLagosWhen(detailAction.transaction.createdAt)}</b></span>
        <span><small>Flag reason</small><b>{detailAction.transaction.flagReason || 'None'}</b></span>
      </div>
      <div className="admin-transaction-description"><small>Description</small><p>{detailAction.transaction.description || 'No description recorded.'}</p></div>
    </div> : detailAction.kind==='email' ? <>
      <label className="cp-field"><span>Subject</span><input required value={detailAction.subject||''} onChange={e=>setDetailAction({...detailAction,subject:e.target.value})} placeholder="Clear, specific subject"/></label>
      <label className="cp-field"><span>Greeting</span><input value={detailAction.greeting||''} onChange={e=>setDetailAction({...detailAction,greeting:e.target.value})} placeholder="Hi John,"/></label>
      <label className="cp-field"><span>Message</span><textarea required rows={8} value={detailAction.message||''} onChange={e=>setDetailAction({...detailAction,message:e.target.value})} placeholder="Write the full details, what happened, what the user needs to know, and any next steps."/></label>
      <label className="cp-field"><span>Closing</span><input value={detailAction.closing||''} onChange={e=>setDetailAction({...detailAction,closing:e.target.value})} placeholder="Regards, CipherPay Support"/></label>
    </> : <>
      <label className="cp-field"><span>Amount (NGN)</span><input required inputMode="decimal" value={detailAction.amount||''} onChange={e=>setDetailAction({...detailAction,amount:e.target.value})} placeholder="0.00"/></label>
      {detailAction.mode==='adjust' && <label className="cp-field"><span>Adjustment</span><select value={detailAction.direction||'credit'} onChange={e=>setDetailAction({...detailAction,direction:e.target.value})}><option value="credit">Credit</option><option value="debit">Debit</option></select></label>}
      <label className="cp-field"><span>Reason / audit note</span><textarea required rows={5} value={detailAction.reason||''} onChange={e=>setDetailAction({...detailAction,reason:e.target.value})} placeholder="Explain exactly why this wallet movement is being made. This is kept in the audit trail."/></label>
    </>}
    <div className="admin-actions" style={{justifyContent:'flex-end'}}><AdminButton onClick={()=>setDetailAction(null)}>Cancel</AdminButton>{detailAction.kind !== 'transaction' && <button className="admin-btn admin-btn-primary" type="submit">{detailAction.kind==='email'?'Send detailed email':'Confirm action'}</button>}</div>
  </form></div>}

  {selectedKyc && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedKyc(null); setKycIdentityCheck(null); } }} style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(3,7,18,.72)', backdropFilter: 'blur(8px)' }}>
    <section role="dialog" aria-modal="true" aria-labelledby="kyc-detail-title" className="cp-card cp-card-pad" style={{ width: 'min(980px, 100%)', maxHeight: '92vh', overflowY: 'auto' }}>
      <div className="admin-panel-head"><div><span className="cp-kicker">KYC / FULL REVIEW</span><h2 id="kyc-detail-title">{selectedKyc.userFirst} {selectedKyc.userLast}</h2><p>{selectedKyc.userEmail} · {selectedKyc.userPhone || 'No phone'} · User #{selectedKyc.userId}</p></div><AdminButton onClick={() => { setSelectedKyc(null); setKycIdentityCheck(null); }}><X size={15} /> Close</AdminButton></div>
      <div className="admin-grid-two" style={{ marginTop: 16 }}>
        <div className="cp-card cp-card-pad"><span className="cp-kicker">Submission</span><h3 style={{ margin: '6px 0 14px' }}>Customer-provided details</h3><div className="admin-detail-list">
          <div><span>Status</span><b>{selectedKyc.status}</b></div><div><span>Verification level</span><b>Level {selectedKyc.level ?? 0}</b></div><div><span>Verification type</span><b>{selectedKyc.verificationType === 'advanced' ? 'Advanced' : 'Basic'}</b></div><div><span>Document</span><b>{String(selectedKyc.documentType ?? '—').toUpperCase()}</b></div><div><span>Document number</span><b>{selectedKyc.documentNumber || selectedKyc.bvn || selectedKyc.nin || '—'}</b></div><div><span>Full name</span><b>{selectedKyc.fullName || '—'}</b></div><div><span>Date of birth</span><b>{selectedKyc.dateOfBirth || '—'}</b></div><div><span>Address</span><b>{selectedKyc.address || '—'}</b></div><div><span>Submitted</span><b>{formatWhen(selectedKyc.submittedAt)}</b></div><div><span>Created</span><b>{formatWhen(selectedKyc.createdAt)}</b></div><div><span>Reviewed by</span><b>{selectedKyc.reviewedBy ? `Admin #${selectedKyc.reviewedBy}` : 'Not reviewed'}</b></div>
        </div></div>
        <div className="cp-card cp-card-pad"><span className="cp-kicker">Live identity check</span><h3 style={{ margin: '6px 0 8px' }}>Government-data validation</h3><p style={{ marginBottom: 14 }}>Run a fresh Dojah check against the submitted BVN/NIN. The result is advisory for admin review and does not auto-approve or reject the KYC.</p><AdminButton variant="primary" onClick={() => void checkKycIdentity()} disabled={checkingKycIdentity}><ShieldCheck size={14} /> {checkingKycIdentity ? 'Checking live data…' : 'Check validity now'}</AdminButton>
          {kycIdentityCheck?.error && <div className="cp-notice cp-notice-error" style={{ marginTop: 14 }}>{kycIdentityCheck.error}</div>}
          {kycIdentityCheck && !kycIdentityCheck.error && <div style={{ marginTop: 16 }}><div className="admin-status admin-status-success" style={{ display: 'inline-flex', marginBottom: 12 }}>{kycIdentityCheck.valid ? 'VALID / MATCHED' : 'NOT FULLY MATCHED'}</div><div className="admin-detail-list">
            <div><span>Provider</span><b>{kycIdentityCheck.provider}</b></div><div><span>Checked</span><b>{formatWhen(kycIdentityCheck.checkedAt)}</b></div><div><span>Document</span><b>{kycIdentityCheck.documentType}</b></div><div><span>Name match</span><b>{kycIdentityCheck.nameMatch ? 'Matched' : 'Did not match'}</b></div><div><span>Date of birth</span><b>{kycIdentityCheck.dobMatch === null ? 'Not returned' : kycIdentityCheck.dobMatch ? 'Matched' : 'Did not match'}</b></div>
            {kycIdentityCheck.firstNameMatch !== undefined && <div><span>First name</span><b>{kycIdentityCheck.firstNameMatch ? `Matched ${kycIdentityCheck.confidence?.firstName ?? ''}%` : 'Did not match'}</b></div>}
            {kycIdentityCheck.lastNameMatch !== undefined && <div><span>Last name</span><b>{kycIdentityCheck.lastNameMatch ? `Matched ${kycIdentityCheck.confidence?.lastName ?? ''}%` : 'Did not match'}</b></div>}
            {kycIdentityCheck.bvnValid !== undefined && <div><span>BVN record</span><b>{kycIdentityCheck.bvnValid ? 'Found and valid' : 'Not valid'}</b></div>}
            {kycIdentityCheck.returned?.name && <div><span>Government record name</span><b>{kycIdentityCheck.returned.name}</b></div>}{kycIdentityCheck.returned?.dateOfBirth && <div><span>Government DOB</span><b>{kycIdentityCheck.returned.dateOfBirth}</b></div>}{kycIdentityCheck.returned?.gender && <div><span>Gender</span><b>{kycIdentityCheck.returned.gender}</b></div>}{kycIdentityCheck.returned?.phone && <div><span>Registered phone</span><b>{kycIdentityCheck.returned.phone}</b></div>}
          </div></div>}
        </div>
      </div>
      <div className="cp-card cp-card-pad" style={{ marginTop: 16 }}><span className="cp-kicker">Submitted evidence</span><h3 style={{ margin: '6px 0 14px' }}>Document and selfie review</h3><div className="admin-grid-two">
        <div><p style={{ marginBottom: 8 }}><b>Front of document</b></p>{selectedKyc.documentFrontUrl ? <img src={selectedKyc.documentFrontUrl} alt="KYC document front" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 12, background: '#0b1020' }} /> : <div className="admin-empty">No front image submitted.</div>}</div>
        <div><p style={{ marginBottom: 8 }}><b>Back of document</b></p>{selectedKyc.documentBackUrl ? <img src={selectedKyc.documentBackUrl} alt="KYC document back" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 12, background: '#0b1020' }} /> : <div className="admin-empty">No back image submitted.</div>}</div>
      </div><div style={{ marginTop: 16 }}><p style={{ marginBottom: 8 }}><b>Selfie</b></p>{selectedKyc.selfieUrl ? <img src={selectedKyc.selfieUrl} alt="KYC selfie" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 12, background: '#0b1020' }} /> : <div className="admin-empty">No selfie submitted.</div>}</div></div>
      <div className="admin-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}><AdminButton variant="danger" onClick={async () => { const reason = await prompt({ title: 'Reject this verification', defaultValue: 'Please submit a clearer document image.', placeholder: 'Reason for rejection', confirmLabel: 'Reject verification', destructive: true }); if (reason) { await run(`/api/admin/kyc/${selectedKyc.id}/reject`, { method: 'POST', body: { reason } }, 'KYC rejected.'); setSelectedKyc(null); } }}>Reject</AdminButton><AdminButton variant="primary" onClick={async () => { const level = selectedKyc.level || (selectedKyc.verificationType === 'basic' ? 1 : 2); await run(`/api/admin/kyc/${selectedKyc.id}/approve`, { method: 'POST', body: { level } }, 'KYC approved.'); setSelectedKyc(null); }}>Approve Level {selectedKyc.level || (selectedKyc.verificationType === 'basic' ? 1 : 2)}</AdminButton></div>
    </section>
  </div>}


    <div className="cp-heading admin-heading"><div><div className="cp-kicker">CipherPay / operations</div><h1>Admin command center.</h1><p>Every user, payment, verification queue, and support request in one place.</p></div><div className="admin-heading-actions"><AdminButton onClick={() => void loadAll()}><RefreshCw size={15} className={loading ? 'admin-spin' : ''} /> Refresh</AdminButton></div></div>
    {error && <div className="cp-notice cp-notice-error admin-notice"><AlertTriangle size={16} />{error}</div>}
    {notice && <div className="cp-notice cp-notice-success admin-notice"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={15} /></button></div>}
    <nav className="admin-tabs" aria-label="Admin areas">{([
       ['overview', 'Overview', Zap], ['users', 'Users', Users], ['support', 'Support inbox', LifeBuoy],
      ['money', 'Transactions', Activity], ['verification', 'Verification', ClipboardCheck], ['social-accounts', 'Social accounts', PackagePlus], ['sellers', 'Sellers', ShieldCheck], ['gift-cards', 'Gift cards', Gift], ['services', 'Service controls', Zap], ['admins', 'Add admin', ShieldCheck],
    ] as const).map(([key, label, Icon]) => {
      const unread = key === 'verification'
        ? adminAlertCounts.verification
        : key === 'support'
          ? Math.max(adminAlertCounts.support, supportChats.filter((chat) => chat.unreadForAdmin > 0).length)
          : key === 'sellers' ? adminAlertCounts.sellers : key === 'gift-cards' ? adminAlertCounts.giftCards : 0;
      return <button type="button" key={key} className={`admin-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}><Icon size={16} />{label}{unread > 0 && <span className="admin-tab-unread" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</button>;
    })}</nav>

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
      <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Email delivery</span><h2>Brevo test</h2><p>Send one real transactional email through the configured CipherPay sender.</p></div><Mail size={19} /></div><AdminButton variant="primary" onClick={() => void testAdminEmail()} disabled={testingEmail}>{testingEmail ? 'Sending test…' : 'Send test email'} <Send size={15} /></AdminButton></section>
      <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Infrastructure</span><h2>Runtime diagnostics</h2><p>Check the outbound address used for provider allowlists.</p></div><button type="button" className="admin-btn admin-btn-soft" onClick={async () => { try { const result = await adminRequest<any>('/api/admin/egress-ip', token); setEgressIp(result.ip); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not check egress IP.'); } }}>Check egress IP</button></div>{egressIp && <div className="admin-code-value">{egressIp}</div>}</section>
    </section>}

       {tab === 'admins' && <section className="admin-section"><div className="admin-grid-two"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Team access</span><h2>Current admins</h2><p>{admins.length} account{admins.length === 1 ? '' : 's'} can access the admin console.</p></div><ShieldCheck size={20} /></div><div className="admin-list">{admins.map((admin) => <div className="admin-list-row" key={admin.id}><div><b>{[admin.firstName, admin.lastName].filter(Boolean).join(' ') || 'CipherPay Admin'}</b><small>{admin.email}{admin.isMaster ? ' · Master admin' : admin.id === currentAdminId ? ' · You' : ''}</small></div><div className="admin-list-actions"><span className={statusClass(admin.isSuspended ? 'suspended' : 'active')}>{admin.isSuspended ? 'Suspended' : 'Active'}</span>{admin.isMaster ? <span className="admin-protected-label">Protected</span> : admin.id === currentAdminId ? <span className="admin-protected-label">Current session</span> : <AdminButton variant="danger" onClick={() => void removeAdmin(admin)}><Trash2 size={13} /> Remove</AdminButton>}</div></div>)}{!admins.length && <div className="admin-empty"><Users size={22} />No admin accounts found.</div>}</div></section><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Team access</span><h2>Create another admin</h2><p>New admins can sign in with their own email and password and review the same operations console.</p></div><UserCheck size={20} /></div><form className="cp-form admin-form" onSubmit={createAdmin}><div className="admin-form-row"><label className="cp-field"><span>Admin email</span><input type="email" value={newAdmin.email} onChange={(event) => setNewAdmin({ ...newAdmin, email: event.target.value })} required placeholder="operator@example.com" /></label><label className="cp-field"><span>Password</span><input type="password" value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} required minLength={8} placeholder="At least 8 characters" /></label></div><AdminButton variant="primary" disabled={creatingAdmin}>{creatingAdmin ? 'Creating…' : 'Create admin'} <UserCheck size={15} /></AdminButton></form></section></div></section>}
     {tab === 'social-accounts' && <AdminSocialAccounts />}

     {tab === 'services' && <section className="admin-section">
       <section className="cp-card cp-card-pad">
         <div className="admin-card-title">
           <div><span className="cp-kicker">SERVICE CONTROL</span><h2>Control every live service.</h2><p>These controls match the services currently exposed by CipherPay. Turning one off blocks its backend routes for customers immediately.</p></div>
           <Zap size={20} />
         </div>
         <div className="admin-service-grid">
           {serviceFeatures.map((feature) => <div className={`admin-service-card ${feature.enabled ? 'is-enabled' : 'is-disabled'}`} key={feature.key}>
             <div className="admin-service-copy">
               <div className="admin-service-icon"><Zap size={16} /></div>
               <div><b>{feature.label}</b><p>{feature.description}</p></div>
             </div>
             <div className="admin-service-control">
               <span className={`admin-service-status ${feature.enabled ? 'online' : 'maintenance'}`}>{feature.enabled ? 'Available' : 'Maintenance'}</span>
               <button type="button" className={`admin-service-toggle ${feature.enabled ? 'is-on' : ''}`} disabled={serviceUpdating === feature.key} onClick={() => void toggleServiceFeature(feature)} aria-label={feature.enabled ? `Disable ${feature.label}` : `Enable ${feature.label}`} aria-pressed={feature.enabled}>
                 <span className="admin-service-toggle-track"><span className="admin-service-toggle-thumb" /></span>
               </button>
             </div>
           </div>)}
           {!serviceFeatures.length && <div className="admin-empty"><Zap size={22} />Service controls are loading.</div>}
         </div>
       </section>
     </section>}

     {tab === 'users' && <section className="admin-section">{selectedUser ? <UserDetailView detail={selectedUser} loading={userDetailLoading} onBack={() => setSelectedUser(null)} onRefresh={() => void openUserDetail(selectedUser.user)} /> : <section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Account control</span><h2>Every registered user</h2><p>Click any customer name to open their complete account, security, device, location, wallet, and activity profile.</p></div><Users size={20} /></div><form className="admin-search" onSubmit={searchUsers}><Search size={17} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search name, email, or phone" /><button type="submit">Search</button></form><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Status</th><th>Wallet</th><th>Joined</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="admin-user-cell"><AdminAvatar user={user} /><span><button type="button" className="admin-user-name-button" onClick={() => void openUserDetails(user)}><b>{user.firstName} {user.lastName}</b></button><small>{user.email}<br />{user.phone}</small></span></div></td><td><span className={statusClass(user.isSuspended ? 'suspended' : user.isVerified ? 'verified' : 'unverified')}>{user.isSuspended ? 'Suspended' : user.isVerified ? 'Verified' : 'Unverified'}</span><small className="admin-muted">KYC {Number(user.kycLevel ?? 0) > 0 ? 'Verified' : 'Not verified'} · L{user.kycLevel ?? 0}</small></td><td><b>{naira(user.balance)}</b></td><td><small>{formatWhen(user.createdAt)}</small></td><td><div className="admin-action-grid"><AdminButton variant="primary" onClick={() => void openUserDetails(user)}><FileText size={13} /> View profile</AdminButton><AdminButton onClick={() => void userAction(user, 'adjust')}>Adjust wallet</AdminButton><AdminButton onClick={() => void userAction(user, 'set-balance')}>Set balance</AdminButton><AdminButton onClick={() => void userAction(user, 'debit-to-admin')}>Debit → admin</AdminButton><AdminButton onClick={() => void userAction(user, 'kyc')}>Set KYC</AdminButton><AdminButton variant={Number(user.kycLevel ?? 0) > 0 ? 'soft' : 'primary'} onClick={() => void userAction(user, 'kyc-verify')}><ShieldCheck size={13} /> {Number(user.kycLevel ?? 0) > 0 ? 'Unverify KYC' : 'Verify KYC'}</AdminButton><AdminButton onClick={() => void userAction(user, 'notify')}><MessageCircle size={13} /> Notify</AdminButton><AdminButton onClick={() => void userAction(user, 'email')}><Mail size={13} /> Email</AdminButton><AdminButton onClick={() => void userAction(user, 'suspend')} variant={user.isSuspended ? 'primary' : 'soft'}>{user.isSuspended ? <><UserCheck size={13} /> Restore</> : <><Ban size={13} /> Suspend</>}</AdminButton><AdminButton onClick={() => void userAction(user, 'verify')}><Check size={13} /> {user.isVerified ? 'Unverify' : 'Verify'}</AdminButton><AdminButton onClick={() => void userAction(user, 'pin')}><ShieldCheck size={13} /> Clear PIN</AdminButton><AdminButton onClick={() => void userAction(user, 'activity')} variant="danger"><RefreshCw size={13} /> Reset activity</AdminButton>{user.isAdmin ? <span className="admin-protected-label">Admin · protected</span> : <AdminButton onClick={() => void userAction(user, 'delete')} variant="danger"><Trash2 size={13} /> Delete</AdminButton>}</div></td></tr>)}</tbody></table>{!users.length && <div className="admin-empty"><Users size={22} />No users match this search.</div>}</div></section>}</section>}

    {tab === 'money' && <section className="admin-section">
      <section className="cp-card cp-card-pad admin-live-transactions">
        <div className="admin-card-title"><div><span className="cp-kicker">LIVE LEDGER MONITOR</span><h2>All recent site transactions</h2><p>Every wallet transaction recorded across CipherPay, newest first. This view refreshes automatically while you are here.</p></div><div className="admin-live-status"><span className="admin-live-dot" /> Live · {transactionLastUpdated ? formatLagosWhen(transactionLastUpdated) : 'checking…'} <AdminButton onClick={() => void refreshTransactions()}><RefreshCw size={14} /> Refresh</AdminButton></div></div>
        <div className="admin-money-stats">
          <StatCard icon={Activity} label="Showing" value={filteredTransactions.length} detail="Recent transaction records" tone="blue" />
          <StatCard icon={CircleDollarSign} label="Pending" value={filteredTransactions.filter((row: any) => row.status === 'pending').length} detail="Awaiting completion" tone="orange" />
          <StatCard icon={Flag} label="Flagged" value={filteredTransactions.filter((row: any) => row.isFlagged).length} detail="Needs admin attention" tone="red" />
          <StatCard icon={CheckCircle2} label="Successful" value={filteredTransactions.filter((row: any) => row.status === 'success').length} detail="Completed successfully" tone="green" />
        </div>
        <div className="admin-transaction-filters">
          <form className="admin-search" onSubmit={searchTransactions}><Search size={17} /><input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="Search reference, provider reference, or metadata" /><button type="submit">Search</button></form>
          <select value={transactionStatusFilter} onChange={(event) => setTransactionStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="success">Successful</option><option value="failed">Failed</option></select>
          <select value={transactionTypeFilter} onChange={(event) => setTransactionTypeFilter(event.target.value)}><option value="all">All transaction types</option>{[...new Set(transactions.map((row: any) => row.type).filter(Boolean))].map((type: string) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select>
        </div>
        <div className="admin-table-wrap"><table className="admin-table admin-live-transaction-table"><thead><tr><th>Time · Lagos</th><th>Customer</th><th>Transaction</th><th>Amount</th><th>Status</th><th>Balance</th><th>Action</th></tr></thead><tbody>
          {filteredTransactions.map((tx: any) => <tr key={tx.id}><td><small>{formatLagosWhen(tx.createdAt)}</small></td><td><b>{tx.userName || 'Customer'}</b><small>{tx.userEmail || '—'} · User #{tx.userId}</small></td><td><b>#{tx.id} · {String(tx.type || 'transaction').replaceAll('_', ' ')}</b><small>{tx.reference}<br />{tx.description || '—'}</small></td><td><b>{naira(tx.amount)}</b>{Number(tx.fee) > 0 && <small>Fee {naira(tx.fee)}</small>}</td><td><span className={statusClass(tx.isFlagged ? 'flagged' : tx.status)}>{tx.isFlagged ? 'Flagged' : tx.status}</span></td><td><small>Before {tx.balanceBefore == null ? '—' : naira(tx.balanceBefore)}<br />After {tx.balanceAfter == null ? '—' : naira(tx.balanceAfter)}</small></td><td><div className="admin-actions"><AdminButton onClick={() => setDetailAction({ kind: 'transaction', transaction: tx })}><FileText size={13} /> Details</AdminButton><AdminButton onClick={() => void run(`/api/admin/transactions/${tx.id}/flag`, { method: 'POST', body: { flagged: !tx.isFlagged, reason: tx.isFlagged ? null : 'Flagged for admin review' } }, tx.isFlagged ? 'Transaction unflagged.' : 'Transaction flagged.')}>{tx.isFlagged ? 'Unflag' : 'Flag'}</AdminButton>{tx.status === 'pending' && <AdminButton variant="primary" onClick={() => void run(`/api/admin/transactions/${tx.id}/mark-success`, { method: 'POST' }, 'Transaction marked successful.')}>Complete</AdminButton>}</div></td></tr>)}
        </tbody></table>{!filteredTransactions.length && <div className="admin-empty"><Activity size={22} />No transactions match these filters.</div>}</div>
        <p className="admin-time-note">All timestamps are displayed in <b>Africa/Lagos · WAT (UTC+1)</b>. New transactions are checked every 5 seconds while this tab is open.</p>
      </section>
    </section>}
    {tab === 'support' && <section className="admin-section admin-support-grid"><section className="cp-card admin-chat-list"><div className="admin-panel-head"><div><span className="cp-kicker">Support records</span><h2>{supportFilter === 'closed' ? 'Conversation history' : 'Support inbox'}</h2><p>{supportFilter === 'closed' ? 'Ended conversations grouped by customer.' : 'Every request from the customer support desk.'}</p></div><AdminButton onClick={() => void loadAll()}><RefreshCw size={14} /></AdminButton></div><div className="admin-support-filters">{(['open', 'closed', 'all'] as const).map((filter) => <button type="button" key={filter} className={supportFilter === filter ? 'active' : ''} onClick={() => { setSelectedSupport(null); setSupportFilter(filter); }}>{filter === 'open' ? 'Open now' : filter === 'closed' ? 'History' : 'All records'}</button>)}</div>{supportChats.length ? supportGroups.map((group) => <div key={group.label}><div className="admin-support-user-heading"><span><Users size={13} />{group.label}</span><small>{group.chats.length} conversation{group.chats.length === 1 ? '' : 's'}</small></div>{group.chats.map((chat) => <button type="button" className={`admin-chat-row ${selectedSupport?.chat?.id === chat.id ? 'active' : ''}`} key={chat.id} onClick={() => void openSupport(chat.id)}><span className={`admin-chat-dot ${chat.status}`} /><span><b>Conversation #{chat.id}</b><small>{chat.userEmail} · {chat.status} · {formatWhen(chat.lastMessageAt)}</small></span>{chat.unreadForAdmin > 0 && <strong>{chat.unreadForAdmin}</strong>}<ChevronRight size={15} /></button>)}</div>) : <div className="admin-empty"><LifeBuoy size={22} />{supportFilter === 'closed' ? 'No ended support conversations.' : 'No open support requests.'}</div>}</section><section className="cp-card admin-chat-detail">{selectedSupport ? <><div className="admin-panel-head"><div><span className="cp-kicker">Conversation #{selectedSupport.chat.id}</span><h2>{selectedSupport.user?.firstName} {selectedSupport.user?.lastName}</h2><p>{selectedSupport.user?.email} · KYC L{selectedSupport.user?.kycLevel ?? 0} · {selectedSupport.user?.isSuspended ? 'Suspended' : 'Active'}</p></div><div className="admin-actions">{selectedSupport.chat.status !== 'live' && selectedSupport.chat.status !== 'closed' && <AdminButton variant="primary" onClick={() => void supportAction('join')}><Headphones size={14} /> Join chat</AdminButton>}{selectedSupport.chat.status !== 'closed' && <AdminButton onClick={() => void supportAction('close')}><Check size={14} /> Close</AdminButton>}</div></div><div className="admin-chat-messages">{(selectedSupport.messages ?? []).map((message: any) => <div className={`admin-message ${message.sender === 'agent' ? 'agent' : message.sender === 'user' ? 'user' : 'system'}`} key={message.id}><small>{message.sender === 'agent' ? 'You / Support' : message.sender === 'user' ? 'Customer' : 'System'} · {formatWhen(message.createdAt)}</small><p>{message.imageUrl && <a href={apiUrl(message.imageUrl ?? "")} target="_blank" rel="noreferrer"><img src={apiUrl(message.imageUrl ?? "")} alt="Attachment from support conversation" /></a>}{message.body !== '📷 Image' && message.body}</p></div>)}</div>{selectedSupport.chat.status !== 'closed' && <form className="admin-chat-compose" onSubmit={sendSupportMessage}><input ref={supportImageRef} className="admin-sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSupportImage(file); }} /><button className="admin-chat-attach" type="button" onClick={() => supportImageRef.current?.click()} disabled={supportUploading}><Paperclip size={16} /></button><input value={supportDraft} onChange={(event) => { setSupportDraft(event.target.value); void adminRequest(`/api/admin/support/chats/${selectedSupport.chat.id}/typing`, token, { method: 'POST' }); }} placeholder={supportUploading ? 'Uploading image…' : 'Reply as Support…'} /><button type="submit" disabled={!supportDraft.trim() || supportUploading}><Send size={16} /></button></form>}</> : <div className="admin-detail-empty"><MessageCircle size={25} /><b>Select a support request</b><span>Messages, customer details, and live controls will appear here.</span></div>}</section></section>}


    {tab === 'sellers' && <AdminSellers token={token} onNotice={setNotice} onError={setError} />}\n\n    {tab === 'gift-cards' && <AdminGiftCards token={token} onNotice={setNotice} onError={setError} prompt={prompt} />}

    {tab === 'verification' && <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Compliance queue</span><h2>Identity review</h2><p>Approve or reject submitted verification records and keep limits current.</p></div><ClipboardCheck size={20} /></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer</th><th>Verification</th><th>Document</th><th>Submitted</th><th>Review</th></tr></thead><tbody>{kycRows.map((row) => { const level = row.level || (row.verificationType === 'basic' ? 1 : 2); return <tr key={row.id}><td><b>{row.userFirst} {row.userLast}</b><small>{row.userEmail}<br />{row.userPhone}</small></td><td><b>{row.verificationType === 'basic' ? 'Basic' : 'Advanced'}</b><small>Level {level}</small></td><td><b>{row.documentType}</b><small>{row.documentNumber}</small></td><td><small>{formatWhen(row.submittedAt)}</small></td><td><div className="admin-actions"><AdminButton onClick={() => openKyc(row)}><FileText size={13} /> View details</AdminButton><AdminButton variant="primary" onClick={() => void run(`/api/admin/kyc/${row.id}/approve`, { method: 'POST', body: { level } }, 'KYC approved.')}>Approve L${level}</AdminButton><AdminButton variant="danger" onClick={async () => { const reason = await prompt({ title: 'Reject this verification', defaultValue: 'Please submit a clearer document image.', placeholder: 'Reason for rejection', confirmLabel: 'Reject verification', destructive: true }); if (reason) void run(`/api/admin/kyc/${row.id}/reject`, { method: 'POST', body: { reason } }, 'KYC rejected.'); }}>Reject</AdminButton></div></td></tr>; })}</tbody></table>{!kycRows.length && <div className="admin-empty">No KYC submissions waiting for review.</div>}</div></section></section>}

    {tab === 'activity' && <section className="admin-section"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Ledger watch</span><h2>Recent transactions</h2><p>Flag suspicious activity, complete pending items, or issue a controlled refund.</p></div><Flag size={19} /></div>
      <form className="admin-search" onSubmit={searchTransactions}>
        <Search size={17} />
        <input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="Search transaction, funding, or provider reference" />
        <button type="submit">Find transaction</button>
      </form>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Transaction</th><th>User</th><th>Amount</th><th>Status</th><th>Controls</th></tr></thead><tbody>{visibleTransactions.map((tx) => <tr key={tx.id}><td><b>#{tx.id} · {tx.type}</b><small>{tx.reference}<br />{formatWhen(tx.createdAt)}</small></td><td><small>{tx.userName || tx.userEmail}</small></td><td><b>{naira(tx.amount)}</b></td><td><span className={statusClass(tx.isFlagged ? 'flagged' : tx.status)}>{tx.isFlagged ? 'Flagged' : tx.status}</span></td><td><div className="admin-actions"><AdminButton onClick={() => void run(`/api/admin/transactions/${tx.id}/flag`, { method: 'POST', body: { flagged: !tx.isFlagged, reason: tx.isFlagged ? null : 'Flagged for admin review' } }, tx.isFlagged ? 'Flag removed.' : 'Transaction flagged.')}>{tx.isFlagged ? 'Unflag' : 'Flag'}</AdminButton>{tx.status === 'pending' && <><AdminButton variant="primary" onClick={() => void run(`/api/admin/transactions/${tx.id}/mark-success`, { method: 'POST' }, 'Transaction marked successful.')}>Mark success</AdminButton><AdminButton variant="danger" onClick={async () => { const reason = await prompt({ title: 'Refund this transaction', defaultValue: 'Reviewed and refunded by admin', placeholder: 'Refund reason', confirmLabel: 'Refund transaction', destructive: true }); if (reason) void run(`/api/admin/transactions/${tx.id}/mark-failed-refund`, { method: 'POST', body: { reason } }, 'Transaction failed and refunded.'); }}>Refund</AdminButton></>}</div></td></tr>)}</tbody></table></div></section><div className="admin-grid-two"><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">SMS activity</span><h2>Recent activations</h2></div><Smartphone size={19} /></div><div className="admin-mini-list">{smsActivations.slice(0, 12).map((row) => <div key={row.id}><span><b>{row.userEmail}</b><small>{row.phoneNumber || row.number} · {row.service}</small></span><span className={statusClass(row.status)}>{row.status}</span></div>)}{!smsActivations.length && <div className="admin-empty">No SMS activations.</div>}</div></section><section className="cp-card cp-card-pad"><div className="admin-card-title"><div><span className="cp-kicker">Social fulfilment</span><h2>Recent social orders</h2></div><Zap size={19} /></div><div className="admin-mini-list">{socialOrders.slice(0, 12).map((row) => <div key={row.id}><span><b>{row.userEmail}</b><small>{row.service} · {row.reference}</small></span><span className={statusClass(row.status)}>{row.status}</span></div>)}{!socialOrders.length && <div className="admin-empty">No social orders.</div>}</div></section></div><section className="cp-card cp-card-pad admin-danger-zone"><div className="admin-card-title"><div><span className="cp-kicker">Restricted system actions</span><h2>Break-glass controls</h2><p>These actions permanently remove data. They are intentionally separate from routine operations and require a second confirmation.</p></div><AlertTriangle size={20} /></div><div className="admin-danger-actions"><AdminButton variant="danger" onClick={async () => { if (!await confirm({ title: 'Reset the entire system?', description: 'This will wipe every non-admin account, wallet, transaction, support chat, KYC record, and notification.', confirmLabel: 'Continue to reset', destructive: true })) return; const phrase = await prompt({ title: 'Confirm system reset', description: 'Type RESET_CIPHERPAY_SYSTEM exactly to continue.', placeholder: 'RESET_CIPHERPAY_SYSTEM', confirmLabel: 'Reset system', destructive: true }); if (phrase === 'RESET_CIPHERPAY_SYSTEM') void run('/api/admin/system/reset', { method: 'POST', headers: { 'x-reset-confirm': phrase } }, 'System reset completed. Admin data was preserved.'); }}>Reset entire system</AdminButton><AdminButton variant="danger" onClick={async () => { if (await confirm({ title: 'Purge completed withdrawals?', description: 'All successful and failed withdrawal records will be deleted. This cannot be undone.', confirmLabel: 'Purge withdrawals', destructive: true })) void run('/api/admin/withdrawals', { method: 'DELETE' }, 'Completed withdrawal records purged.'); }}>Purge completed withdrawals</AdminButton></div></section></section>}

    {selectedUserDetails && <div className="admin-user-detail-backdrop" role="dialog" aria-modal="true" aria-label="User profile details">
      <section className="admin-user-detail-drawer">
        <div className="admin-user-detail-header">
          <div className="admin-user-detail-identity">
            <AdminAvatar user={selectedUserDetails.user} large />
            <div>
              <span className="cp-kicker">CUSTOMER PROFILE · #{selectedUserDetails.user.id}</span>
              <h2>{selectedUserDetails.user.firstName} {selectedUserDetails.user.lastName}</h2>
              <p>{selectedUserDetails.user.email} · {selectedUserDetails.user.phone || 'No phone number'}</p>
            </div>
          </div>
          <div className="admin-user-detail-header-actions">
            <span className={statusClass(selectedUserDetails.user.isSuspended ? 'suspended' : selectedUserDetails.user.isVerified ? 'verified' : 'unverified')}>{selectedUserDetails.user.isSuspended ? 'Suspended' : selectedUserDetails.user.isVerified ? 'Verified' : 'Unverified'}</span>
            <button type="button" className="admin-icon-close" onClick={() => setSelectedUserDetails(null)} aria-label="Close user details"><X size={19} /></button>
          </div>
        </div>

        <div className="admin-user-detail-meta"><span>Created <b>{formatLagosWhen(selectedUserDetails.user.createdAt)}</b></span><span>Updated <b>{formatLagosWhen(selectedUserDetails.user.updatedAt)}</b></span><span>Console timezone <b>Africa/Lagos · WAT (UTC+1)</b></span></div>

        <div className="admin-user-detail-body">
          <section className="admin-user-detail-stats">
            <StatCard icon={WalletCards} label="Available balance" value={naira(selectedUserDetails.wallet.balance)} detail={selectedUserDetails.wallet.currency} tone="green" />
            <StatCard icon={CircleDollarSign} label="Ledger balance" value={naira(selectedUserDetails.wallet.ledgerBalance)} detail="Accounting balance" tone="purple" />
            <StatCard icon={Database} label="Transactions" value={selectedUserDetails.activity.transactionCount} detail={`${selectedUserDetails.activity.successfulTransactions} successful`} tone="orange" />
            <StatCard icon={ShieldCheck} label="Active sessions" value={selectedUserDetails.security.activeSessions} detail={`${selectedUserDetails.security.totalSessions} recorded`} tone="blue" />
          </section>

          <div className="admin-user-detail-grid">
            <section className="cp-card cp-card-pad">
              <div className="admin-card-title"><div><span className="cp-kicker">IDENTITY & ACCOUNT</span><h3>Account information</h3></div><UserCheck size={19} /></div>
              <div className="admin-detail-facts">
                <span><small>Full name</small><b>{selectedUserDetails.user.firstName} {selectedUserDetails.user.lastName}</b></span>
                <span><small>Email</small><b>{selectedUserDetails.user.email}</b></span>
                <span><small>Phone</small><b>{selectedUserDetails.user.phone || '—'}</b></span>
                <span><small>Gender</small><b>{selectedUserDetails.user.gender || 'Not provided'}</b></span>
                <span><small>Account number</small><b>{selectedUserDetails.user.accountNumber || '—'}</b></span>
                <span><small>User code</small><b>{selectedUserDetails.user.userCode || '—'}</b></span>
                <span><small>Referral code</small><b>{selectedUserDetails.user.referralCode || '—'}</b></span>
                <span><small>Referred by</small><b>{selectedUserDetails.user.referredBy || 'Direct signup'}</b></span>
                <span><small>KYC level</small><b>L{selectedUserDetails.user.kycLevel ?? 0}</b></span>
                <span><small>Account status</small><b>{selectedUserDetails.user.isSuspended ? `Suspended · ${selectedUserDetails.user.suspendReason || 'No reason recorded'}` : 'Active'}</b></span>
              </div>
            </section>

            <section className="cp-card cp-card-pad">
              <div className="admin-card-title"><div><span className="cp-kicker">SECURITY & ACCESS</span><h3>Login intelligence</h3></div><ShieldCheck size={19} /></div>
              <div className="admin-detail-facts">
                <span><small>Last logged in / active</small><b>{formatLagosWhen(selectedUserDetails.security.lastLoggedInAt)}</b></span>
                <span><small>Last IP address</small><b className="admin-mono">{selectedUserDetails.security.lastIpAddress || '—'}</b></span>
                <span><small>Last device</small><b>{selectedUserDetails.security.lastDevice ? `${selectedUserDetails.security.lastDevice.deviceName} · ${selectedUserDetails.security.lastDevice.platform}` : '—'}</b></span>
                <span><small>Known IPs</small><b>{selectedUserDetails.knownIps.length ? selectedUserDetails.knownIps.join(' · ') : 'No IP history recorded'}</b></span>
                <span><small>Generated</small><b>{formatLagosWhen(selectedUserDetails.generatedAt)}</b></span>
              </div>
            </section>
          </div>

          <section className="cp-card cp-card-pad">
            <div className="admin-card-title"><div><span className="cp-kicker">WALLET</span><h3>Financial snapshot</h3><p>Current balances plus the customer's recorded money movement totals.</p></div><WalletCards size={19} /></div>
            <div className="admin-financial-strip">
              <span><small>Available</small><b>{naira(selectedUserDetails.wallet.balance)}</b></span>
              <span><small>Ledger</small><b>{naira(selectedUserDetails.wallet.ledgerBalance)}</b></span>
              <span><small>Provider-held</small><b>{naira(selectedUserDetails.wallet.flwSubaccountBalance)}</b></span>
              <span><small>Total incoming</small><b>{naira(selectedUserDetails.activity.totalIncoming)}</b></span>
              <span><small>Total outgoing</small><b>{naira(selectedUserDetails.activity.totalOutgoing)}</b></span>
              <span><small>Fees recorded</small><b>{naira(selectedUserDetails.activity.totalFees)}</b></span>
            </div>
          </section>

          <section className="cp-card cp-card-pad">
            <div className="admin-card-title"><div><span className="cp-kicker">DEVICES & LOCATIONS</span><h3>Session history</h3><p>IP-derived location is approximate. Timestamps are shown in Lagos time.</p></div><Smartphone size={19} /></div>
            <div className="admin-session-list">
              {selectedUserDetails.sessions.length ? selectedUserDetails.sessions.map((session: any) => <div className="admin-session-row" key={session.id}>
                <div className="admin-session-icon"><Smartphone size={17} /></div>
                <div className="admin-session-main"><b>{session.deviceName || 'Unknown device'}</b><span>{session.platform || 'Unknown platform'} · Session #{session.id}</span><span>{session.ipAddress || 'No IP recorded'}{session.location ? ` · ${[session.location.city, session.location.region, session.location.country].filter(Boolean).join(', ')}` : ''}</span></div>
                <div className="admin-session-time"><span className={statusClass(session.revoked ? 'revoked' : 'active')}>{session.revoked ? 'Revoked' : 'Active'}</span><small>Last active<br />{formatLagosWhen(session.lastActiveAt)}</small><small>Started<br />{formatLagosWhen(session.createdAt)}</small></div>
              </div>) : <div className="admin-empty"><Smartphone size={22} />No recorded sessions.</div>}
            </div>
          </section>

          <section className="cp-card cp-card-pad">
            <div className="admin-card-title"><div><span className="cp-kicker">TRANSACTION HISTORY</span><h3>Every recorded money movement</h3><p>Showing the latest {selectedUserDetails.transactions.length} transactions returned for this user.</p></div><Database size={19} /></div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-user-transactions"><thead><tr><th>Time</th><th>Type / reference</th><th>Amount</th><th>Status</th><th>Balance</th><th>Review</th></tr></thead><tbody>
                {selectedUserDetails.transactions.map((tx: any) => <tr key={tx.id}><td><small>{formatLagosWhen(tx.createdAt)}</small></td><td><b>{tx.type}</b><small>{tx.reference}<br />{tx.description}</small></td><td><b>{naira(tx.amount)}</b>{Number(tx.fee) > 0 && <small>Fee {naira(tx.fee)}</small>}</td><td><span className={statusClass(tx.isFlagged ? 'flagged' : tx.status)}>{tx.isFlagged ? 'Flagged' : tx.status}</span></td><td><small>Before {tx.balanceBefore == null ? '—' : naira(tx.balanceBefore)}<br />After {tx.balanceAfter == null ? '—' : naira(tx.balanceAfter)}</small></td><td>{tx.flagReason ? <small>{tx.flagReason}</small> : <small>—</small>}</td></tr>)}
              </tbody></table>
              {!selectedUserDetails.transactions.length && <div className="admin-empty">No transactions recorded for this user.</div>}
            </div>
          </section>

          <div className="admin-user-detail-grid">
            <section className="cp-card cp-card-pad">
              <div className="admin-card-title"><div><span className="cp-kicker">VERIFICATION</span><h3>KYC record</h3></div><ClipboardCheck size={19} /></div>
              {selectedUserDetails.kyc ? <div className="admin-detail-facts">
                <span><small>Status</small><b>{selectedUserDetails.kyc.status}</b></span><span><small>Level</small><b>L{selectedUserDetails.kyc.level}</b></span>
                <span><small>Document</small><b>{selectedUserDetails.kyc.documentType || '—'}</b></span><span><small>Document number</small><b>{selectedUserDetails.kyc.documentNumber || '—'}</b></span>
                <span><small>BVN</small><b>{selectedUserDetails.kyc.bvn || '—'}</b></span><span><small>NIN</small><b>{selectedUserDetails.kyc.nin || '—'}</b></span>
                <span><small>Date of birth</small><b>{selectedUserDetails.kyc.dateOfBirth || '—'}</b></span><span><small>Address</small><b>{selectedUserDetails.kyc.address || '—'}</b></span>
                <span><small>Submitted</small><b>{formatLagosWhen(selectedUserDetails.kyc.submittedAt)}</b></span><span><small>Verified</small><b>{formatLagosWhen(selectedUserDetails.kyc.verifiedAt)}</b></span>
              </div> : <div className="admin-empty">No KYC record found.</div>}
            </section>

            <section className="cp-card cp-card-pad">
              <div className="admin-card-title"><div><span className="cp-kicker">ACCOUNT ACTIVITY</span><h3>Usage footprint</h3></div><Activity size={19} /></div>
              <div className="admin-detail-facts">
                <span><small>Notifications</small><b>{selectedUserDetails.activity.notifications}</b></span><span><small>Support conversations</small><b>{selectedUserDetails.activity.supportChats}</b></span>
                <span><small>Social orders</small><b>{selectedUserDetails.activity.socialOrders}</b></span><span><small>SMS activations</small><b>{selectedUserDetails.activity.smsActivations}</b></span>
                <span><small>Flagged transactions</small><b>{selectedUserDetails.activity.flaggedTransactions}</b></span><span><small>Successful transactions</small><b>{selectedUserDetails.activity.successfulTransactions}</b></span>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>}
  </main>;
}